// deno-lint-ignore-file no-explicit-any
export const deepEquals = (objA: any, objB: any): boolean =>
  objA === objB
    ? true
    : typeof objA !== "object" || typeof objB !== "object"
    ? false
    : JSON.stringify(objA) === JSON.stringify(objB);

export const deepCopy = (obj: any): any =>
  typeof obj === "object" ? JSON.parse(JSON.stringify(obj)) : obj;

export const shallowCopy = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.slice(0);
  } else if (typeof obj === "object") {
    const copy = Object.create(null);
    const props = Object.keys(obj);
    for (let i = 0; i < props.length; i++) {
      copy[props[i]] = obj[props[i]];
    }
    return copy;
  }
  return obj;
};

const hasUrlProtocol = /^wss:|^ws:|^\/\//;

const unsupportedProtocol = /^http:|^https:/;

export const parseUrl = (initialURl: string, defaultPath: string): string => {
  let url = initialURl;
  if (unsupportedProtocol.test(url)) {
    throw new Error("Only ws and wss are supported");
  }
  if (!hasUrlProtocol.test(url)) {
    url = `ws://${url}`;
  } else if (url.indexOf("//") === 0) {
    url = `ws:${url}`;
  }

  const protocol = url.split("//")[0];
  let host = url.split("//")[1];

  if (!host) {
    throw new Error("Invalid URL: ws://");
  }

  let path = null;
  if (host.indexOf("/") > -1) {
    path = host.split("/");
    host = path.shift() || "";
    path = "/" + path.join("");
  } else {
    if (host.indexOf("?") > -1) {
      path = host.split("?");
      host = path.shift() || "";
      path = defaultPath + "?" + path.join("");
    }
  }

  if (!path || path === "/") path = defaultPath;

  return `${protocol}//${host}${path}`;
};

export const getUid = (): string => {
  const timestamp = (new Date()).getTime().toString(36);
  const randomString = crypto.randomUUID().replace("-", "");

  return `${timestamp}-${randomString}`;
};

export interface RecordSetArguments {
  callback?: (error: string | null, recordName: string) => void;
  path?: string;
  data?: any;
}
export interface RecordSubscribeArguments {
  callback: (data: any) => void;
  path?: string;
  triggerNow?: boolean;
}

export const normalizeSetArguments = (
  args: IArguments,
  startIndex = 0,
): RecordSetArguments => {
  let result;
  const isRootData = (data: any) =>
    data !== undefined && typeof data === "object";
  const isNestedData = (data: any) => typeof data !== "function";
  const isPath = (path: any) => path !== undefined && typeof path === "string";
  const isCallback = (callback: any) => typeof callback === "function";

  if (args.length === startIndex + 1) {
    result = {
      path: undefined,
      data: isRootData(args[startIndex]) ? args[startIndex] : undefined,
      callback: undefined,
    };
  }

  if (args.length === startIndex + 2) {
    result = { path: undefined, data: undefined, callback: undefined };
    if (!isCallback(args[startIndex]) && isNestedData(args[startIndex])) {
      result.path = isPath(args[startIndex]) ? args[startIndex] : undefined;
    }

    if (isPath(args[startIndex])) {
      result.data = isNestedData(args[startIndex + 1])
        ? args[startIndex + 1]
        : undefined;
    } else {
      result.data = isRootData(args[startIndex]) ? args[startIndex] : undefined;
    }
    if (!isPath(args[startIndex])) {
      result.callback = isCallback(args[startIndex + 1])
        ? args[startIndex + 1]
        : false;
    }
  }

  if (args.length === startIndex + 3) {
    result = {
      path: isPath(args[startIndex]) ? args[startIndex] : undefined,
      data: isNestedData(args[startIndex + 1])
        ? args[startIndex + 1]
        : undefined,
      callback: isCallback(args[startIndex + 2])
        ? args[startIndex + 2]
        : undefined,
    };
  }

  if (result) {
    if (
      result.path !== undefined && result.path.length === 0 ||
      (result.path === undefined && !result.data)
    ) {
      throw Error("Invalid set path argument");
    }
    if (result.data === undefined && result.path === undefined) {
      throw Error("Invalid set data argument");
    }
    if (
      result.callback !== undefined && result.callback === false ||
      result.callback === undefined && args.length === startIndex + 3
    ) {
      throw Error("Invalid set callback argument");
    }
    return result;
  }

  throw Error("Invalid set arguments");
};

export const normalizeArguments = (
  args: IArguments,
): RecordSubscribeArguments => {
  if (args.length === 1 && typeof args[0] === "object") {
    return args[0];
  }

  const result = Object.create(null);

  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] === "string") {
      result.path = args[i];
    } else if (typeof args[i] === "function") {
      result.callback = args[i];
    } else if (typeof args[i] === "boolean") {
      result.triggerNow = args[i];
    }
  }
  return result;
};

export const PromiseDelay = (time: number): Promise<void> =>
  new Promise((done) => setTimeout(done, time));
