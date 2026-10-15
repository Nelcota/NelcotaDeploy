#!/usr/bin/env python3
"""Measure supplied live PIDs and deploy DTOs; absent evidence stays pending."""
import argparse
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--panel-pid', type=int)
p.add_argument('--agent-pid', type=int)
p.add_argument('--deployment', type=Path, help='JSON de GET /api/deployments/{id}')
p.add_argument('--app-kind', choices=['node', 'go'])
p.add_argument('--webhook-seconds', type=float)
p.add_argument('--install-seconds', type=float)
p.add_argument('--lost-requests', type=int)
p.add_argument('--proxy-ms', type=float)
p.add_argument('--output', type=Path)
a = p.parse_args()
results = []

def record(name, measured, ceiling, unit):
    if measured is not None and measured < 0:
        raise SystemExit('Medição negativa inválida: ' + name)
    exclusive = name in ('webhook_to_queue', 'shallow_clone', 'proxy_overhead')
    results.append({'metric': name, 'value': measured, 'target_max': ceiling, 'exclusive_max': exclusive,
                    'unit': unit, 'status': 'pending' if measured is None else
                    ('pass' if (measured < ceiling if exclusive else measured <= ceiling) else 'fail')})

def rss(pid):
    if pid is None:
        return None
    for line in Path(f'/proc/{pid}/status').read_text().splitlines():
        if line.startswith('VmRSS:'):
            return int(line.split()[1]) / 1024
    raise SystemExit('VmRSS não disponível')

record('panel_idle_rss', rss(a.panel_pid), 60, 'MiB')
record('agent_idle_rss', rss(a.agent_pid), 25, 'MiB')
record('webhook_to_queue', a.webhook_seconds, 1, 'seconds')
stages, duration = {}, None
if a.deployment:
    deploy = json.loads(a.deployment.read_text())
    if deploy.get('status') != 'success':
        raise SystemExit('Medição de deploy exige status success')
    stages = deploy.get('timings', {})
    if deploy.get('finished_at') and deploy.get('queued_at'):
        duration = deploy['finished_at'] - deploy['queued_at']
record('shallow_clone', stages.get('clone') / 1000 if 'clone' in stages else None, 5, 'seconds')
for kind, maximum in [('node', 40), ('go', 15)]:
    record(f'{kind}_cached_deploy', duration if a.app_kind == kind else None, maximum, 'seconds')
ready = sum(stages[k] for k in ('start', 'healthcheck', 'route')) / 1000 if all(k in stages for k in ('start', 'healthcheck', 'route')) else None
record('start_health_route', ready, 10, 'seconds')
record('lost_requests', a.lost_requests, 0, 'requests')
record('proxy_overhead', a.proxy_ms, 1, 'ms')
record('installation', a.install_seconds, 300, 'seconds')
output = json.dumps({'measurements': results, 'note': 'Metas requerem VPS e carga representativas; pending não confirma a meta.'}, indent=2)
if a.output:
    a.output.write_text(output + '\n')
print(output)
if any(r['status'] == 'fail' for r in results):
    raise SystemExit(1)
