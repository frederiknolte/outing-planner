"""Self-check for the container's egress firewall.

Run on the server:   docker exec outing-planner egress-check
Optionally test specific addresses too, e.g. your Unraid host's LAN and Tailscale IPs:
    docker exec outing-planner egress-check 192.168.1.10 100.101.102.103

Every "must be blocked" target should report BLOCKED; the internet checks should report OK.
"""
from __future__ import annotations

import errno
import os
import socket
import subprocess
import sys

BLOCKED_ERRNOS = {errno.EHOSTUNREACH, errno.EACCES, errno.EPERM, errno.ENETUNREACH}


def default_gateway() -> str | None:
    try:
        with open("/proc/net/route") as f:
            for line in f.readlines()[1:]:
                p = line.split()
                if p[1] == "00000000":
                    return socket.inet_ntoa(bytes.fromhex(p[2])[::-1])
    except OSError:
        pass
    return None


def probe(host: str, port: int, timeout: float = 3.0) -> tuple[str, str]:
    fam = socket.AF_INET6 if ":" in host else socket.AF_INET
    s = socket.socket(fam, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return "open", "connected"
    except ConnectionRefusedError:
        return "reached", "connection refused by the target (packet got there)"
    except socket.timeout:
        return "timeout", "no answer"
    except OSError as e:
        if e.errno in BLOCKED_ERRNOS:
            return "blocked", os.strerror(e.errno)
        return "error", str(e)
    finally:
        s.close()


def main() -> int:
    bad = 0
    print(f"Running as uid {os.getuid()}\n")
    print("Must be BLOCKED:")
    targets = [
        (default_gateway(), 80, "container's gateway (Unraid host)"),
        ("100.100.100.100", 53, "Tailscale MagicDNS"),
        ("100.64.0.1", 80, "Tailscale address range (host's tailnet)"),
        ("192.168.1.1", 80, "typical LAN router"),
        ("192.168.0.1", 80, "typical LAN router"),
        ("10.0.0.1", 80, "private range 10/8"),
        ("172.17.0.1", 80, "Docker default bridge"),
        ("fd7a:115c:a1e0::1", 80, "Tailscale IPv6 range"),
    ] + [(a, 80, "given on command line") for a in sys.argv[1:]]
    for host, port, what in targets:
        if not host:
            continue
        state, detail = probe(host, port)
        if state == "blocked" or (":" in host and state == "error"):
            mark = "BLOCKED"
        elif state == "timeout":
            mark = "no answer (not proof, but nothing replied)"
        else:
            mark, bad = "LEAK!", bad + 1
        print(f"  {host:>20}:{port:<5} {what:<42} {mark}  ({detail})")

    print("\nMust be OK (internet):")
    try:
        ip = socket.gethostbyname("controlplane.tailscale.com")
        print(f"  DNS lookup controlplane.tailscale.com -> {ip}  OK")
    except OSError as e:
        bad += 1
        print(f"  DNS lookup failed: {e}  FAIL")
    state, detail = probe("1.1.1.1", 443)
    ok = state == "open"
    bad += 0 if ok else 1
    print(f"  {'1.1.1.1':>20}:443   {'public internet':<42} {'OK' if ok else 'FAIL'}  ({detail})")

    print("\nFirewall can't be changed by the app:")
    try:
        r = subprocess.run(["iptables", "-w", "-F", "OUTPUT"], capture_output=True, text=True, timeout=5)
        changed = r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        changed = False
    bad += 1 if changed else 0
    print(f"  iptables -F OUTPUT as uid {os.getuid()}: {'SUCCEEDED, which is bad' if changed else 'denied  OK'}")

    print("\nResult:", "ALL GOOD" if not bad else f"{bad} PROBLEM(S)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
