// MIT License — Copyright (c) 2026 blucca
// Small executable model of the URL boundary discussed in the accompanying guide.
export function converterUrlBefore(target, parameters) {
  const query = new URLSearchParams(parameters).toString();
  return `${target}${query ? `?${query}` : ''}`;
}

export function converterUrlAfter(target, parameters) {
  const url = new URL(target);
  for (const [key, value] of new URLSearchParams(parameters)) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

export function inspectUrl(value) {
  const url = new URL(value);
  const parameters = {};
  for (const key of new Set(url.searchParams.keys())) {
    Object.defineProperty(parameters, key, {
      value: url.searchParams.getAll(key), enumerable: true,
    });
  }
  return { url: url.toString(), parameters };
}
