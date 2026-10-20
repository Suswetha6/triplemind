#!/bin/sh
# Runs before 20-envsubst-on-templates.sh. The envsubst script refuses to run
# if its output directory is missing or unwritable, and /tmp is a fresh tmpfs
# on every start, so the directory has to be created here.
set -e
mkdir -p /tmp/nginx-conf /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp
