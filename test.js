const r = /\$\{vault:([^}]+)\}/g;
console.log(r.test('foo ${vault:abc}'));
console.log(r.test('foo ${vault:abc}'));
