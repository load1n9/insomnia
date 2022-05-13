import { DeepstreamClient } from "../mod.ts";

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
