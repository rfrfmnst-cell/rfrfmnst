import shellStyles from './account.module.css';
import managementStyles from './account-management.module.css';
import profileStyles from './account-profile.module.css';

type ClassMap = Readonly<Record<string, string>>;

function mergeClassMaps(...maps: readonly ClassMap[]): ClassMap {
  const merged: Record<string, string> = {};

  for (const map of maps) {
    for (const [name, className] of Object.entries(map)) {
      const current = merged[name];
      merged[name] = current ? `${current} ${className}` : className;
    }
  }

  return Object.freeze(merged);
}

/**
 * Some responsive selectors intentionally live after the management rules in
 * the original cascade. Merging module class names keeps those selectors bound
 * to the same elements while the three CSS files retain their source order.
 */
const styles = mergeClassMaps(
  shellStyles,
  managementStyles,
  profileStyles,
);

export default styles;
