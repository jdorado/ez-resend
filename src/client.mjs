import {request} from 'node:http';

export function client(socketPath, command, args = []) {
  return new Promise((resolve, reject) => {
    const req = request({socketPath, path: '/', method: 'POST', timeout: 15000}, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (response.statusCode !== 200 || result.ok !== true) throw Error(result?.error || 'Resend service unavailable');
          resolve(result.data);
        } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(Error('Resend service unavailable')));
    req.on('error', () => reject(Error('Resend service unavailable')));
    req.end(JSON.stringify({command, args}));
  });
}
