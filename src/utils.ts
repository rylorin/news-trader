import { LegType, LegTypeEnum } from "./trader";

/**
 * @internal
 *
 * JSON replace function to convert ES6 Maps to tuple arrays.
 */
function jsonReplacer(key: string, value: any): any {
  if (value instanceof Map) {
    const tuples: [unknown, unknown][] = [];
    value.forEach((v, k) => {
      tuples.push([k, v]);
    });
    return tuples;
  } else {
    return value;
  }
}

/**
 * Convert an object (JSON formatted) to string.
 */
export function formatObject(obj: unknown): string {
  return `${JSON.stringify(obj, jsonReplacer, 2)}`;
}

export function string2boolean(text: string | boolean): boolean {
  if (typeof text == "boolean") return text;
  const bool: string = text.trim().toLowerCase();
  return bool == "true" || bool == "on" || bool == "yes";
}

export function oppositeLeg(leg: LegType): LegType {
  switch (leg) {
    case LegTypeEnum.Put:
      return LegTypeEnum.Call;
    case LegTypeEnum.Call:
      return LegTypeEnum.Put;
  }
}

export function parseEvent(text: string): number | undefined {
  const now = Date.now();
  let event;
  switch (text.toLowerCase()) {
    case "now":
      event = now;
      break;
    case "none":
    case "off":
    case "undefined":
      event = undefined;
      break;
    default:
      if (text.startsWith("+")) {
        const mins = parseInt(text.substring(1));
        event = now + mins * 60_000;
      } else if (text.length < 10) {
        const s = new Date().toISOString().substring(0, 11) + text;
        // Only events in the future are accepted
        event = new Date(s).getTime() > now ? new Date(s).getTime() : undefined;
      } else {
        // Only events in the future are accepted
        event =
          new Date(text.toUpperCase()).getTime() > now ?
            new Date(text.toUpperCase()).getTime()
          : undefined;
      }
  }
  return event;
}

export function deepCopy(object: Record<string, any>): Record<string, any> {
  return JSON.parse(JSON.stringify(object)) as Record<string, any>;
}
