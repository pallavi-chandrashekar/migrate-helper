from mylib import authenticate, fetchData

client = MyClient(key='abc', secret='xyz')

def main():
    auth = authenticate('my-token')
    client.connect(timeout=3000)
    users = fetchData('/api/v1/users')
    print(users)

if __name__ == '__main__':
    main()
