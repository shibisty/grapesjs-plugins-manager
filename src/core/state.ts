/**
 * The manager's persistent state in localStorage:
 *   `<prefix>:disabled` — ids switched off by the user
 *   `<prefix>:known`    — built-in plugin ids seen in `config.plugins`
 *
 * Same keys and format as 0.x, so an existing state survives the upgrade.
 * Every access is guarded: storage may be missing, full or throwing.
 */
export class StateStore {
  constructor(
    private readonly storage: Storage | null,
    readonly prefix: string
  ) {}

  get disabledKey(): string {
    return `${this.prefix}:disabled`;
  }

  get knownKey(): string {
    return `${this.prefix}:known`;
  }

  /** True for the manager's own keys (hidden from the Settings tab). */
  isOwnKey(key: string): boolean {
    return key === this.prefix || key.startsWith(`${this.prefix}:`);
  }

  getDisabled(): Set<string> {
    return new Set(this.readList(this.disabledKey));
  }

  isDisabled(id: string): boolean {
    return this.getDisabled().has(id);
  }

  setDisabled(id: string, disabled: boolean): void {
    const set = this.getDisabled();
    if (disabled === set.has(id)) return;
    if (disabled) set.add(id);
    else set.delete(id);
    this.writeList(this.disabledKey, Array.from(set));
  }

  getKnown(): string[] {
    return this.readList(this.knownKey);
  }

  /** Adds ids to the known list, keeping the existing order. */
  remember(ids: string[]): void {
    const known = this.getKnown();
    let changed = false;
    ids.forEach((id) => {
      if (!known.includes(id)) {
        known.push(id);
        changed = true;
      }
    });
    if (changed) this.writeList(this.knownKey, known);
  }

  /** Drops an id from both lists. */
  forget(id: string): void {
    const known = this.getKnown();
    if (known.includes(id)) this.writeList(this.knownKey, known.filter((k) => k !== id));
    this.setDisabled(id, false);
  }

  private readList(key: string): string[] {
    try {
      const raw = this.storage?.getItem(key);
      if (!raw) return [];
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private writeList(key: string, list: string[]): void {
    try {
      this.storage?.setItem(key, JSON.stringify(list));
    } catch {
      /* quota exceeded / storage disabled: the state just is not persisted */
    }
  }
}
