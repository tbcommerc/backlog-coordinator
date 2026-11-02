FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
RUN apt-get update && apt-get install -y --no-install-recommends iptables util-linux ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global opencode-ai@1.17.13
COPY deploy/runtime-entrypoint.sh /usr/local/bin/runtime-entrypoint
RUN chmod 755 /usr/local/bin/runtime-entrypoint
ENV OPENCODE_CONFIG=/run/opencode.json OPENCODE_DISABLE_AUTOUPDATE=true \
    OPENCODE_DISABLE_DEFAULT_PLUGINS=true OPENCODE_DISABLE_PROJECT_CONFIG=true \
    OPENCODE_DISABLE_CLAUDE_CODE=true OPENCODE_DISABLE_EXTERNAL_SKILLS=true \
    HOME=/state/home XDG_CONFIG_HOME=/state/config XDG_DATA_HOME=/state/data \
    XDG_STATE_HOME=/state/state XDG_CACHE_HOME=/state/cache OPENCODE_SERVER_USERNAME=opencode
ENTRYPOINT ["/usr/local/bin/runtime-entrypoint"]
