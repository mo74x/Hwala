{{/*
Expand the name of the chart.
*/}}
{{- define "hwala-core.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "hwala-core.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "hwala-core.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "hwala-core.labels" -}}
helm.sh/chart: {{ include "hwala-core.chart" . }}
{{ include "hwala-core.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "hwala-core.selectorLabels" -}}
app.kubernetes.io/name: {{ include "hwala-core.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
API Selector labels
*/}}
{{- define "hwala-core.apiSelectorLabels" -}}
{{ include "hwala-core.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Worker Selector labels
*/}}
{{- define "hwala-core.workerSelectorLabels" -}}
{{ include "hwala-core.selectorLabels" . }}
app.kubernetes.io/component: worker
{{- end }}

{{/*
PostgreSQL Selector labels
*/}}
{{- define "hwala-core.postgresSelectorLabels" -}}
{{ include "hwala-core.selectorLabels" . }}
app.kubernetes.io/component: postgres
{{- end }}

{{/*
Redis Selector labels
*/}}
{{- define "hwala-core.redisSelectorLabels" -}}
{{ include "hwala-core.selectorLabels" . }}
app.kubernetes.io/component: redis
{{- end }}
