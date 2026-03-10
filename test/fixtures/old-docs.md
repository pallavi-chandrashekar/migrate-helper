# MyLib API v1.0

## Client Setup

Initialize the client with your credentials:

```js
const client = new MyClient({ key: 'abc', secret: 'xyz' });
client.connect({ timeout: 5000 });
```

## Authentication

Use `authenticate(token)` to verify user identity:

```js
function authenticate(token) {
  return client.verify(token);
}
```

## Data Fetching

Use `fetchData(endpoint)` to retrieve records:

```js
const data = fetchData('/api/v1/users');
```

## Legacy Export

This method is deprecated and will be removed:

```js
function exportCSV(data) {
  return formatCSV(data);
}
```
