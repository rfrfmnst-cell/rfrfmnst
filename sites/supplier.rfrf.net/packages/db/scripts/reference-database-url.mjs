const NAME = /^rafraf_reference_[0-9]+_[0-9]+$/u;
const ASCII_CONTROL = /[\u0000-\u001f\u007f]/u;

function decodeCredential(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('Reference database URL is invalid');
  }
}

function containsControl(value) {
  return typeof value !== 'string' || ASCII_CONTROL.test(value);
}

export function deriveReferenceDatabaseEnvironment(rawUrl, databaseName) {
  if (!NAME.test(databaseName ?? ''))
    throw new Error('Reference database URL inputs are invalid');
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Reference database URL is invalid');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    containsControl(rawUrl)
  ) {
    throw new Error('Reference database URL is invalid');
  }
  const decodedUsername = decodeCredential(url.username);
  const decodedPassword = decodeCredential(url.password);
  if (
    [url.username, url.password, decodedUsername, decodedPassword].some(
      containsControl,
    )
  ) {
    throw new Error('Reference database URL is invalid');
  }
  url.pathname = `/${databaseName}`;
  const derivedUrl = url.toString();
  const maskValues = [
    ...new Set([
      url.username,
      decodedUsername,
      url.password,
      decodedPassword,
      derivedUrl,
    ]),
  ];
  if ([derivedUrl, ...maskValues].some(containsControl)) {
    throw new Error('Reference database URL is invalid');
  }
  return {
    url,
    maskValues,
    envLine: `REFERENCE_DATABASE_NAME=${databaseName}`,
    urlEnvLine: `REFERENCE_DIRECT_URL=${derivedUrl}`,
  };
}

export async function exportReferenceDatabaseEnvironment(
  environment,
  { maskWriter, environmentWriter },
) {
  if (
    !environment ||
    !Array.isArray(environment.maskValues) ||
    typeof environment.urlEnvLine !== 'string' ||
    typeof environment.envLine !== 'string' ||
    environment.maskValues.some(containsControl) ||
    containsControl(environment.envLine) ||
    containsControl(environment.urlEnvLine) ||
    typeof maskWriter !== 'function' ||
    typeof environmentWriter !== 'function'
  ) {
    throw new Error('Reference database URL export contract is invalid');
  }
  for (const value of environment.maskValues) await maskWriter(value);
  await environmentWriter(
    `${environment.envLine}\n${environment.urlEnvLine}\n`,
  );
}
