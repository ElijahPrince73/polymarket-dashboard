const defaultHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

const buildUrl = (baseUrl, path) => new URL(path, baseUrl).toString();

const safeJson = async (response) => {
  if (response.status === 204 || response.status === 205) {
    return null;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength === "0") {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const proxyRequest = async ({
  baseUrl,
  path,
  method = "GET",
  body,
  headers = {},
}) => {
  const response = await fetch(buildUrl(baseUrl, path), {
    method,
    headers: { ...defaultHeaders, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const json = await safeJson(response);

  if (json === null && response.status !== 204 && response.status !== 205) {
    throw new Error(`Upstream returned non-JSON response for ${method} ${path}`);
  }

  return {
    status: response.status,
    body: json,
  };
};
