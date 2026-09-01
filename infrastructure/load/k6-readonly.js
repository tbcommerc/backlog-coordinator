import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const tokens = (__ENV.ACCESS_TOKENS || '').split(',').map(value => value.trim()).filter(Boolean);
const authenticatedLatency = new Trend('authenticated_read_latency', true);

export const options = {
  scenarios: {
    read_only_ramp: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: __ENV.RAMP_DURATION || '30s', target: Number(__ENV.TARGET_VUS || 20) },
        { duration: __ENV.STEADY_DURATION || '2m', target: Number(__ENV.TARGET_VUS || 20) },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
    authenticated_read_latency: ['p(95)<1500'],
  },
};

export default function () {
  const token = tokens.length ? tokens[(__VU - 1) % tokens.length] : '';
  const params = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  const path = token ? '/api/v1/tasks?page=1&per_page=20' : '/api/v1/health/ready';
  const response = http.get(`${baseUrl}${path}`, params);
  if (token) authenticatedLatency.add(response.timings.duration);
  check(response, {
    'HTTP 200': result => result.status === 200,
    'request correlation header': result => Boolean(result.headers['X-Request-Id']),
  });
  sleep(0.2);
}
