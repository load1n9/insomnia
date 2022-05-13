# Insomnia

deepstream.io client deno wrapper

# install
install the server from [here](https://github.com/deepstreamIO/deepstream.io/releases)
# usage
```ts
import { DeepstreamClient } from "https://deno.land/x/insomnia/mod.ts";

const client = new DeepstreamClient("localhost:6020");
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
