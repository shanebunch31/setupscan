export async function dispatchResearchRunRoute({ pathname, request, response, url, researchRunApi }) {
  if (
    pathname !== '/api/research-runs'
    && !pathname.startsWith('/api/research-runs/')
    && !pathname.startsWith('/api/research-datasets/')
  ) {
    return false
  }

  await researchRunApi(request, response, url)
  return true
}
