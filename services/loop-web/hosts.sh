#!/bin/sh
# Renders PLAN_WEB_EXTRA_HOSTS into /etc/nginx/hc-extra-hosts.map, which nginx.conf.template
# includes in its Host allowlist (map $host $hc_host_ok). Mounted as
# /docker-entrypoint.d/15-hc-hosts.sh, so nginx:alpine runs it at every start, before the template
# (20-envsubst-on-templates.sh) and before nginx.
#
# By default the page answers only to IP literals and localhost (DNS rebinding protection). To reach
# it by a name too, set PLAN_WEB_EXTRA_HOSTS="plan.lan, nas.home.arpa" (comma or space separated) in
# services/loop-web/.env, and the same names in loop-ingest's FOOD_ALLOWED_HOSTS. Each name becomes
# ONE exact, lowercased map key (never a regex); anything but letters, digits, dots and hyphens is
# skipped with a warning.
set -eu
set -f # the names are not file globs
out="${HC_HOSTS_MAP:-/etc/nginx/hc-extra-hosts.map}"
: > "$out"
for h in $(printf '%s' "${PLAN_WEB_EXTRA_HOSTS:-}" | tr ',' ' '); do
  h=$(printf '%s' "$h" | tr 'A-Z' 'a-z')
  case "$h" in
    *[!a-z0-9.-]* | .* | *. | -* | *..*)
      echo "15-hc-hosts: ignoring invalid host name: $h" >&2
      ;;
    *)
      printf '%s 1;\n' "$h" >> "$out"
      ;;
  esac
done
