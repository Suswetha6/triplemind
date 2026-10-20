{{/* Base name, overridable so the release name does not have to leak into
     DNS names that other components (nginx upstream, dashboards) depend on. */}}
{{- define "triplemind.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "triplemind.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "triplemind.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Labels every object carries. app.kubernetes.io/version is the deployed
     application version, which is how a running pod is traced to a commit. */}}
{{- define "triplemind.labels" -}}
helm.sh/chart: {{ include "triplemind.chart" . }}
{{ include "triplemind.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.global.appVersion | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: triplemind
{{- end -}}

{{- define "triplemind.selectorLabels" -}}
app.kubernetes.io/name: {{ include "triplemind.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Per-component helpers: each component gets its own selector so the two
     Deployments scale and roll independently. */}}
{{- define "triplemind.componentLabels" -}}
{{ include "triplemind.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "triplemind.componentSelectorLabels" -}}
{{ include "triplemind.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "triplemind.backendFullname" -}}
{{- printf "%s-backend" (include "triplemind.fullname" .) -}}
{{- end -}}

{{- define "triplemind.frontendFullname" -}}
{{- printf "%s-frontend" (include "triplemind.fullname" .) -}}
{{- end -}}

{{- define "triplemind.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "triplemind.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Image reference. Digests win over tags when supplied, so a release can be
     pinned to immutable bytes rather than a movable tag. */}}
{{- define "triplemind.image" -}}
{{- $img := .image -}}
{{- $tag := default .defaultTag $img.tag -}}
{{- if $img.digest -}}
{{- printf "%s@%s" $img.repository $img.digest -}}
{{- else -}}
{{- printf "%s:%s" $img.repository $tag -}}
{{- end -}}
{{- end -}}
