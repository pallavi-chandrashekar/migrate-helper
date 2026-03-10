# MyLib API v2.0

## Client Configuration

Initialize the new client with updated credentials:

```js
const client = new NewClient({ apiKey: 'abc', apiSecret: 'xyz' });
client.init({ timeoutMs: 5000 });
```

## Authentication

Use `authenticate(token, options)` to verify user identity. The deprecated single-argument form is no longer supported:

```js
function authenticate(token, options) {
  return client.verify(token, options);
}
```

## Data Fetching

Use `fetchData(endpoint, config)` to retrieve records with new config support:

```js
const data = fetchData('/api/v2/users', { retry: true });
```

## Streaming API

New streaming support for large datasets:

```js
const stream = client.stream('/api/v2/events', { batchSize: 100 });
stream.on('data', handleEvent);
```
