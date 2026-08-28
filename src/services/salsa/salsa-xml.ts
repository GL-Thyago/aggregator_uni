export function parseSalsaRequest(xml: string): { method: string; params: Record<string, string> } | null {
  const methodMatch = xml.match(/<Method\b[^>]*\bName="([^"]+)"/i);
  if (!methodMatch) return null;

  const paramsBlock = xml.match(/<Params>([\s\S]*?)<\/Params>/i);
  const params: Record<string, string> = {};
  if (paramsBlock) {
    const re = /<(\w+)([^>]*)\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(paramsBlock[1]!)) !== null) {
      const name = m[1]!;
      if (name.toLowerCase() === "params") continue;
      const valueMatch = m[2]!.match(/\bValue="([^"]*)"/i);
      if (valueMatch) params[name] = decodeXml(valueMatch[1]!);
    }
  }

  return { method: methodMatch[1]!, params };
}

export function salsaParam(params: Record<string, string>, ...keys: string[]): string {
  const lower = new Map(Object.entries(params).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const value = lower.get(key.toLowerCase());
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function encodeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function salsaSuccess(
  method: string,
  fields: Record<string, string | number | boolean | bigint>,
): string {
  const body = Object.entries(fields)
    .map(([key, val]) => {
      const type =
        typeof val === "boolean" ? "bool" : typeof val === "bigint" ? "long" : typeof val === "number" ? "int" : "string";
      return `<${key} Type="${type}" Value="${encodeXml(String(val))}" />`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<PKT>\n<Result Name="${method}" Success="1">\n<Returnset>\n${body}\n</Returnset>\n</Result>\n</PKT>`;
}

export function salsaFailure(
  method: string,
  error: string,
  errorCode: string,
  extra?: Record<string, string | number>,
): string {
  const extras = extra
    ? Object.entries(extra)
        .map(([key, val]) => {
          const type = typeof val === "number" ? "int" : "string";
          return `<${key} Type="${type}" Value="${encodeXml(String(val))}" />`;
        })
        .join("\n")
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>\n<PKT>\n<Result Name="${method}" Success="0">\n<Returnset>\n<Error Type="string" Value="${encodeXml(error)}" />\n<ErrorCode Type="string" Value="${errorCode}" />\n${extras}\n</Returnset>\n</Result>\n</PKT>`;
}
