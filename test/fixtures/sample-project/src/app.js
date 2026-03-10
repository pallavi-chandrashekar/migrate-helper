import { authenticate, fetchData } from 'mylib';

const client = new MyClient({ key: 'abc', secret: 'xyz' });

async function main() {
  const auth = authenticate('my-token');
  client.connect({ timeout: 3000 });

  const users = fetchData('/api/v1/users');
  const csv = exportCSV(users);

  console.log(csv);
}

main();
