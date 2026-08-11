/* eslint-disable no-global-assign */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { RedisService } from '../redis/redis.service';

describe('ExchangeService', () => {
  let service: ExchangeService;
  let module: TestingModule;
  let redisService: jest.Mocked<RedisService>;

  let configService: jest.Mocked<ConfigService>;
  let mockRedisClient: any;

  beforeEach(async () => {
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
    };

    redisService = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
    } as any;

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        switch (key) {
          case 'FX_BASE_CURRENCY':
            return 'USD';
          case 'FX_CACHE_TTL':
            return 3600;
          case 'FX_API_URL':
            return 'https://open.er-api.com/v6/latest/USD';
          case 'FX_API_KEY':
            return '';
          default:
            return defaultValue;
        }
      }),
    } as any;

    module = await Test.createTestingModule({
      providers: [
        ExchangeService,
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ExchangeService>(ExchangeService);

    // Reset global fetch mock if any
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getExchangeRate', () => {
    it('should return rate 1.0 for same currency pair without API call', async () => {
      const result = await service.getExchangeRate('USD', 'USD');
      expect(result).toEqual({ rate: 1.0, source: 'cache' });
      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for empty or invalid currency strings', async () => {
      await expect(service.getExchangeRate('', 'EUR')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getExchangeRate('USD', '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should calculate exchange rate correctly using cached rates', async () => {
      const mockRates = {
        USD: 1.0,
        EUR: 0.92,
        GBP: 0.79,
      };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(mockRates));

      const result = await service.getExchangeRate('EUR', 'GBP');

      expect(result.source).toBe('cache');
      // 0.79 / 0.92 = 0.85869565... -> rounded to 0.858696
      expect(result.rate).toBeCloseTo(0.858696, 4);
    });

    it('should throw BadRequestException if currency is unsupported in rate table', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({ USD: 1.0, EUR: 0.92 }),
      );

      await expect(service.getExchangeRate('USD', 'XYZ')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('convert', () => {
    it('should perform currency conversion and return detailed result', async () => {
      mockRedisClient.get.mockResolvedValue(
        JSON.stringify({ USD: 1.0, EUR: 0.92 }),
      );

      const result = await service.convert(100, 'USD', 'EUR');

      expect(result).toEqual({
        amount: 100,
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        exchangeRate: 0.92,
        convertedAmount: 92,
        source: 'cache',
      });
    });

    it('should throw BadRequestException for invalid or negative amount', async () => {
      await expect(service.convert(0, 'USD', 'EUR')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.convert(-50, 'USD', 'EUR')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.convert(NaN, 'USD', 'EUR')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getLatestRates', () => {
    it('should return rates from Redis cache if available (cache hit)', async () => {
      const mockRates = { USD: 1.0, EUR: 0.92, GBP: 0.79 };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(mockRates));

      const { rates, source } = await service.getLatestRates('USD');

      expect(mockRedisClient.get).toHaveBeenCalledWith('fx:rates:USD');
      expect(rates).toEqual(mockRates);
      expect(source).toBe('cache');
    });

    it('should fetch live rates and update Redis cache on cache miss', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.set.mockResolvedValue('OK');

      const mockApiRates = { USD: 1.0, EUR: 0.95, JPY: 150.0 };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ rates: mockApiRates }),
      } as any);

      const { rates, source } = await service.getLatestRates('USD');

      expect(source).toBe('api');
      expect(rates).toEqual(mockApiRates);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'fx:rates:USD',
        JSON.stringify(mockApiRates),
        'EX',
        3600,
      );
    });

    it('should use default fallback rates if API call fails and cache is empty', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      global.fetch = jest.fn().mockRejectedValue(new Error('Network Error'));

      const { rates, source } = await service.getLatestRates('USD');

      expect(source).toBe('fallback');
      expect(rates.USD).toBe(1.0);
      expect(rates.EUR).toBeDefined();
    });
  });
});
