const VAULT_REF_PATTERN = /\$\{vault:([^}]+)\}/g;
console.log(VAULT_REF_PATTERN.test('foo ${vault:abc}'));
console.log(VAULT_REF_PATTERN.test('foo ${vault:abc}'));
