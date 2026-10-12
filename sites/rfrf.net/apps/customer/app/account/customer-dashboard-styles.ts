import layoutStyles from './customer-dashboard.module.css';
import orderStyles from './customer-dashboard-orders.module.css';
import supportStyles from './customer-dashboard-support.module.css';

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

export default mergeClassMaps(layoutStyles, orderStyles, supportStyles);
