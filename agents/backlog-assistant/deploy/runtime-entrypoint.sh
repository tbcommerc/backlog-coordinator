#!/bin/sh
set -eu
case "$BRIDGE_PORT" in ''|*[!0-9]*) exit 64;; esac
bridge_ip="$BRIDGE_IP"
case "$bridge_ip" in ''|*[!0-9.]*) exit 64;; esac
iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -d "$bridge_ip" -p tcp --dport "$BRIDGE_PORT" -j ACCEPT
ip6tables -P OUTPUT DROP
mkdir -p /state/home /state/config /state/data /state/state /state/cache /state/workspace
chown -R 10001:10001 /state
cd /state/workspace
# Hard lifetime remains effective if the controlling worker dies.
exec setpriv --reuid=10001 --regid=10001 --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
    timeout --signal=KILL 90 opencode serve --hostname 0.0.0.0 --port 4096
