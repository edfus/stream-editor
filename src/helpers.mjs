const checkIsColorEnabled = (
  tty  =>
    "FORCE_COLOR" in process.env
      ? [1, 2, 3, "", true, "1", "2", "3", "true"].includes(process.env.FORCE_COLOR)
      : !(
        "NO_COLOR" in process.env ||
        process.env.NODE_DISABLE_COLORS == 1 // using == by design
      ) && tty.isTTY
);


/**
 * format output
 */

let inspect;
export async function verbose(err, parsedOptions, orinOptions) {
  if (!inspect)
    inspect = (await import("util")).inspect;

  if (typeof parsedOptions !== "object")
    return err;

  const indent = " ".repeat(2);
  const depth = 1;
  const colors = checkIsColorEnabled(process.stderr);

  err.message = err.message.concat([
    "\nParsed options: {",
    ...Object.entries(parsedOptions).map(([key, value]) =>
      indent.concat(`${key}: ${inspect(value, { depth, colors }).replace(/\n/g, `\n${indent}`)}`)
    ),
    "}\n",
    `Original options: ${inspect(orinOptions, { depth, colors })}`
  ].join("\n").replace(/\n/g, `\n${indent}`));

  return err;
}

export function warn(warning) {
  if (checkIsColorEnabled(process.stdout)) {
    console.warn(`\x1b[33m${warning}\x1b[0m`);
  } else {
    console.warn(warning);
  }
}

/**
 * options related
 */

 export class Options {
  constructor(options) {
    this.options = Object.assign({}, options);
    this.got = Symbol("got");
  }

  _has(name) {
    return name in this.options;
  }

  _get(name) {
    const result = this.options[name];
    if (name in this.options)
      this.options[name] = this.got;
    return result;
  }

  _warnUnknown() {
    const unknownOptions = [];
    for (const prop of Object.keys(this.options)) {
      if (this.options[prop] !== this.got) {
        unknownOptions.push(prop);
      }
    }
    if (unknownOptions.length) {
      warn(
        `stream-editor: Received unknown/unneeded options: ${unknownOptions.join(', ')}.`
      );
    }
  }

  has = name => this._has(name);
  get = name => this._get(name);
  warnUnknown = () => this._warnUnknown();
}

export function findWithDefault(options, defaultOptions, ...names) {
  const result = {};
  for (const name of names) {
    if (options[name] !== undefined) {
      result[name] = options[name];
    } else {
      result[name] = defaultOptions[name];
    }
  }
  return result;
}

/**
 * validation
 */

export function is(toValidate, ...types) {
  return types.some(type => validate(toValidate, type));
}

export function validate(...args) {
  const should_be = args.splice(args.length - 1, 1)[0];

  if (should_be === Array)
    return args.every(arg => Array.isArray(arg) && arg.length);

  const type = typeof should_be;
  switch (type) {
    case "function": return args.every(arg => arg instanceof should_be);
    case "object": return args.every(arg => typeof arg === "object" && arg.constructor === should_be.constructor);
    case "string": return args.every(arg => typeof arg === "string" && arg.length >= should_be.length);
    case "number": return args.every(arg => typeof arg === "number" && !isNaN(arg) && arg >= should_be); // comparing NaN with other numbers always returns false, though.
    default: return args.every(arg => typeof arg === type);
  }
}

