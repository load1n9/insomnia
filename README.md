# Insomnia

deepstream.io client deno wrapper  | directly ported from [deepstream.io-client-js](https://github.com/deepstreamIO/deepstream.io-client-js)

# install
install the server from [here](https://github.com/deepstreamIO/deepstream.io/releases)
# usage
```ts
import { InsomniaClient } from "https://deno.land/x/insomnia/mod.ts";

const client = new InsomniaClient("localhost:6020");
client.login({ username: "peter", password: "sesame" }, (success, data) => {
  if (!success) throw new Error(JSON.stringify(data));
  const record = client.record.getRecord("some-name");
  // deno-lint-ignore no-explicit-any
  record.set("firstname", "test" as any);
  record.subscribe("firstname", (value) => {
    console.log(value);
  });
});
```
### Maintainers
- Loading ([@load1n9](https://github.com/load1n9))
