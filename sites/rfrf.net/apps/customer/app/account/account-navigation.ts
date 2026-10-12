export function customerAccountPath() {
  return '/account';
}

export function customerSettingsPath() {
  return '/account/settings';
}

export function customerSettingsProfilePath(status: string) {
  const params = new URLSearchParams({ profile: status });
  return `${customerSettingsPath()}?${params.toString()}#profile`;
}

export function customerSettingsSectionPath(section: string) {
  return `${customerSettingsPath()}#${encodeURIComponent(section)}`;
}
