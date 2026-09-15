export interface ServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export function createServiceFetch(
  getService: () => ServiceBinding | null | undefined | Promise<ServiceBinding | null | undefined>,
): (request: Request | string, init?: RequestInit) => Promise<Response> {
  return async (request: Request | string, init?: RequestInit): Promise<Response> => {
    const req = request instanceof Request ? request : new Request(request, init);
    const service = await getService();
    if (service) return service.fetch(req);
    return fetch(req);
  };
}
