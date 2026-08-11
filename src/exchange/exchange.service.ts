/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

export interface FxConversionResult {
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  exchangeRate: number;
  convertedAmount: number;
  source: 'cache' | 'api' | 'fallback';
}

const DEFAULT_FALLBACK_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  AED: 3.67,
  SAR: 3.75,
  EGP: 48.5,
  CAD: 1.36,
  JPY: 155.0,
  CHF: 0.9,
  AUD: 1.52,
  INR: 83.5,
};

@Injectable()
export class ExchangeService {
  private readonly logger = new Logger(ExchangeService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Get the exchange rate from one currency to another.
   * Rates are computed relative to base currency (USD by default).
   */
  async getExchangeRate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<{ rate: number; source: 'cache' | 'api' | 'fallback' }> {
    const from = fromCurrency.toUpperCase().trim();
    const to = toCurrency.toUpperCase().trim();

    if (!from || !to) {
      throw new BadRequestException('Currency codes must be non-empty strings');
    }

    if (from === to) {
      return { rate: 1.0, source: 'cache' };
    }

    const baseCurrency = this.configService.get<string>(
      'FX_BASE_CURRENCY',
      'USD',
    );
    const { rates, source } = await this.getLatestRates(baseCurrency);

    const fromRate = rates[from];
    const toRate = rates[to];

    if (!fromRate) {
      throw new BadRequestException(
        `Unsupported or unknown source currency: ${from}`,
      );
    }

    if (!toRate) {
      throw new BadRequestException(
        `Unsupported or unknown target currency: ${to}`,
      );
    }

    // Rate calculation: from -> to = (base -> to) / (base -> from)
    const rawRate = toRate / fromRate;
    const rate = Number(rawRate.toFixed(6));

    return { rate, source };
  }

  /**
   * Perform currency conversion before locking a transfer in DB.
   */
  async convert(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<FxConversionResult> {
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be a positive number');
    }

    const from = fromCurrency.toUpperCase().trim();
    const to = toCurrency.toUpperCase().trim();

    const { rate, source } = await this.getExchangeRate(from, to);
    const rawConverted = amount * rate;
    const convertedAmount = Number(rawConverted.toFixed(4));

    return {
      amount,
      fromCurrency: from,
      toCurrency: to,
      exchangeRate: rate,
      convertedAmount,
      source,
    };
  }

  /**
   * Fetch exchange rates for base currency (checking Redis cache first, then live API, with fallback).
   */
  async getLatestRates(baseCurrency = 'USD'): Promise<{
    rates: Record<string, number>;
    source: 'cache' | 'api' | 'fallback';
  }> {
    const base = baseCurrency.toUpperCase().trim();
    const cacheKey = `fx:rates:${base}`;
    const ttl = Number(this.configService.get<number>('FX_CACHE_TTL', 3600));

    //Attempt to fetch from Redis cache
    try {
      const redisClient = this.redisService.getClient();
      if (redisClient) {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          const rates = JSON.parse(cachedData) as Record<string, number>;
          this.logger.debug(`FX rates cache hit for base currency: ${base}`);
          return { rates, source: 'cache' };
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Redis cache read failed for FX rates: ${errorMessage}. Falling back to live API.`,
      );
    }

    //Cache miss: Fetch from live FX API
    try {
      const liveRates = await this.fetchLiveRates(base);
      if (liveRates) {
        // Cache rates in Redis
        try {
          const redisClient = this.redisService.getClient();
          if (redisClient) {
            await redisClient.set(
              cacheKey,
              JSON.stringify(liveRates),
              'EX',
              ttl,
            );
          }
        } catch (cacheErr: unknown) {
          const errorMessage =
            cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
          this.logger.warn(
            `Failed to write FX rates to Redis: ${errorMessage}`,
          );
        }
        return { rates: liveRates, source: 'api' };
      }
    } catch (apiErr: unknown) {
      const errorMessage =
        apiErr instanceof Error ? apiErr.message : String(apiErr);
      this.logger.error(
        `Live FX API call failed: ${errorMessage}. Using fallback rates.`,
      );
    }

    //Fallback rates
    this.logger.warn(
      `Using default fallback FX rates for base currency ${base}`,
    );
    return { rates: DEFAULT_FALLBACK_RATES, source: 'fallback' };
  }

  /**
   * Internal helper to make HTTP request to configured FX API endpoint.
   */
  private async fetchLiveRates(
    baseCurrency: string,
  ): Promise<Record<string, number> | null> {
    const apiUrl = this.configService.get<string>(
      'FX_API_URL',
      'https://open.er-api.com/v6/latest/USD',
    );
    const apiKey = this.configService.get<string>('FX_API_KEY', '');

    let url = apiUrl;
    if (apiKey) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}apikey=${encodeURIComponent(apiKey)}`;
    }

    this.logger.log(`Fetching live FX exchange rates from endpoint: ${apiUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.error(
          `FX API returned HTTP status ${response.status}: ${response.statusText}`,
        );
        return null;
      }

      const data = await response.json();

      // Normalize responses across different FX providers (OpenExchangeRates, Fixer, ExchangeRate-API)
      const rates = data.rates || data.conversion_rates;
      if (rates && typeof rates === 'object') {
        return rates as Record<string, number>;
      }

      this.logger.error('Unexpected response format from FX API', data);
      return null;
    } catch (err: unknown) {
      clearTimeout(timeout);
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to fetch live FX rates: ${errorMessage}`);
      return null;
    }
  }
}
