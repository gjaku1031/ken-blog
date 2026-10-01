#!/bin/sh
set -eu

# 인증서용 IP와 NIC 바인딩을 분리하고, ACME에 사설/예약 IP를 보내지 않는다.
if ! awk -v public="${KEN_BLOG_PUBLIC_IP:-}" -v bind="${KEN_BLOG_PUBLIC_BIND_IP:-}" '
    function octets(ip, parts, n, i) {
        n = split(ip, parts, ".")
        if (n != 4) return 0
        for (i = 1; i <= 4; i++) {
            if (parts[i] !~ /^[0-9]+$/ || parts[i] ~ /^0[0-9]+$/ || parts[i] + 0 > 255) return 0
        }
        return 1
    }
    function private(ip, a) {
        split(ip, a, ".")
        return a[1] == 10 || (a[1] == 172 && a[2] >= 16 && a[2] <= 31) ||
            (a[1] == 192 && a[2] == 168)
    }
    function public_ip(ip, a) {
        if (!octets(ip)) return 0
        split(ip, a, ".")
        if (a[1] == 0 || a[1] == 10 || a[1] == 127 || a[1] >= 224) return 0
        if (a[1] == 100 && a[2] >= 64 && a[2] <= 127) return 0
        if (a[1] == 169 && a[2] == 254) return 0
        if (a[1] == 172 && a[2] >= 16 && a[2] <= 31) return 0
        if (a[1] == 192 && (a[2] == 168 || (a[2] == 0 && (a[3] == 0 || a[3] == 2)))) return 0
        if (a[1] == 198 && (a[2] == 18 || a[2] == 19 || (a[2] == 51 && a[3] == 100))) return 0
        if (a[1] == 203 && a[2] == 0 && a[3] == 113) return 0
        return 1
    }
    BEGIN {
        if (!public_ip(public) || !octets(bind) || !private(bind) || public == bind) exit 1
    }
' </dev/null; then
    echo 'KEN_BLOG_PUBLIC_IP must be a public IPv4; KEN_BLOG_PUBLIC_BIND_IP must be a different private NIC IPv4' >&2
    exit 2
fi

exec caddy "$@"
