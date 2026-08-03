import { describe, it, expect } from 'vitest';
import { parseSkillUpload, splitFrontmatter, slugify } from '../src/modules/skills/import/parse.js';
import { ValidationError } from '../src/platform/errors.js';
import { DEMO_ARCHIVE_ENTRIES, makeZip } from './helpers/zip-fixture.js';

/**
 * Skill import. This is the trust boundary of the whole feature, so it is tested
 * as a boundary: what gets in, what is refused, and — the claim the product
 * makes on camera — exactly what the importer declines to open.
 *
 * Ring 0: pure parsing, no app, no DB, no Docker.
 */

const md = (s: string) => Buffer.from(s, 'utf8');

describe('markdown import', () => {
  it('takes the body and derives name/description when there is no frontmatter', () => {
    const p = parseSkillUpload({
      filename: 'api-contract-guard.md',
      content: md('# API contract\n\nFlag breaking route signature changes. Cite the route.'),
    });
    expect(p.name).toBe('api-contract-guard');
    expect(p.body).toContain('Flag breaking route signature changes.');
    expect(p.description).toBe('Flag breaking route signature changes.');
    expect(p.source).toBe('imported_file');
    expect(p.origin).toMatchObject({ kind: 'markdown', filename: 'api-contract-guard.md' });
    expect(p.entry_path).toBeNull();
    expect(p.ignored).toEqual([]);
  });

  it('honours name/description/type from frontmatter and drops everything else', () => {
    const p = parseSkillUpload({
      filename: 'whatever.md',
      content: md(
        [
          '---',
          'name: secret-leakage-gate',
          'description: Detect committed secrets.',
          'type: security',
          'allowed-tools: Bash',
          'command: ./go.sh',
          'hooks: preToolUse',
          '---',
          '',
          'Body text.',
        ].join('\n'),
      ),
    });
    expect(p).toMatchObject({
      name: 'secret-leakage-gate',
      description: 'Detect committed secrets.',
      type: 'security',
      body: 'Body text.',
    });
    expect(p.frontmatter.used.sort()).toEqual(['description', 'name', 'type']);
    // The keys that would make a skill do something. They are reported, never stored.
    expect(p.frontmatter.dropped.sort()).toEqual(['allowed-tools', 'command', 'hooks']);
  });

  it('normalises a non-slug name and says so, rather than failing or silently renaming', () => {
    const p = parseSkillUpload({
      filename: 'x.md',
      content: md('---\nname: My Fancy Rule\n---\n\nBody.'),
    });
    expect(p.name).toBe('my-fancy-rule');
    expect(p.warnings.join(' ')).toMatch(/normalised to "my-fancy-rule"/);
  });

  it('says the frontmatter name was REJECTED when it falls back to the filename', () => {
    // "!!!" slugifies to "", so the filename wins. Reporting that as
    // `normalised to "api-contract-guard"` would name a string that had nothing
    // to do with the result, and send the reader to fix the wrong thing.
    const p = parseSkillUpload({
      filename: 'api-contract-guard.md',
      content: md('---\nname: "!!!"\n---\n\nBody.'),
    });
    expect(p.name).toBe('api-contract-guard');
    const warning = p.warnings.join(' ');
    expect(warning).toContain('not a usable skill name');
    expect(warning).toContain('from the filename');
    expect(warning).not.toMatch(/normalised/);
  });

  it('falls back to "custom" for an unknown type, with a warning', () => {
    const p = parseSkillUpload({
      filename: 'x.md',
      content: md('---\nname: a-rule\ntype: wizardry\n---\n\nBody.'),
    });
    expect(p.type).toBe('custom');
    expect(p.warnings.join(' ')).toMatch(/Unknown type "wizardry"/);
  });

  it.each([
    ['an empty body', 'x.md', '---\nname: a-rule\n---\n\n   \n'],
    ['an undeivable name', '💥.md', 'Body with no frontmatter.'],
  ])('refuses %s', (_label, filename, content) => {
    expect(() => parseSkillUpload({ filename, content: md(content) })).toThrow(ValidationError);
  });

  it('refuses a file type that is neither markdown nor an archive', () => {
    expect(() => parseSkillUpload({ filename: 'skill.exe', content: md('MZ') })).toThrow(
      /Only \.md and \.zip/,
    );
  });

  it('refuses a markdown file over the size cap', () => {
    const huge = md('# a\n' + 'x'.repeat(300 * 1024));
    expect(() => parseSkillUpload({ filename: 'big.md', content: huge })).toThrow(/limit/);
  });
});

describe('archive import — what is read, and what is only listed', () => {
  it('reads SKILL.md and names every other entry as ignored', () => {
    const p = parseSkillUpload({
      filename: 'uncovered-branch-gate.zip',
      content: makeZip(DEMO_ARCHIVE_ENTRIES),
    });

    expect(p.name).toBe('uncovered-branch-gate');
    expect(p.entry_path).toBe('uncovered-branch-gate/SKILL.md');
    expect(p.body).toContain('For every `if`, `switch` or ternary');
    expect(p.origin.kind).toBe('archive');

    // THE claim: the executable clutter is listed, with a reason, and its
    // contents are nowhere in the preview.
    const ignored = p.ignored.map((i) => i.path);
    expect(ignored).toContain('uncovered-branch-gate/run.sh');
    expect(ignored).toContain('uncovered-branch-gate/package.json');
    expect(p.ignored.every((i) => i.reason.length > 0)).toBe(true);

    const serialised = JSON.stringify(p);
    expect(serialised).not.toContain('curl evil.example');
    expect(serialised).not.toContain('postinstall');

    // …and its frontmatter's executable keys are dropped, not honoured.
    expect(p.frontmatter.dropped.sort()).toEqual(['allowed-tools', 'command']);
  });

  it('prefers the shallowest SKILL.md when several exist', () => {
    const p = parseSkillUpload({
      filename: 'a.zip',
      content: makeZip([
        { path: 'deep/nested/SKILL.md', content: '# Deep\n\nDeep body.' },
        { path: 'SKILL.md', content: '# Shallow\n\nShallow body.' },
      ]),
    });
    expect(p.entry_path).toBe('SKILL.md');
    expect(p.body).toContain('Shallow body.');
  });

  it('takes the only markdown file when there is no SKILL.md', () => {
    const p = parseSkillUpload({
      filename: 'a.zip',
      content: makeZip([
        { path: 'docs/rule.md', content: '# Rule\n\nBody.' },
        { path: 'LICENSE', content: 'MIT' },
      ]),
    });
    expect(p.entry_path).toBe('docs/rule.md');
    expect(p.ignored.map((i) => i.path)).toEqual(['LICENSE']);
  });

  it('refuses to guess between several markdown files, and names them', () => {
    expect(() =>
      parseSkillUpload({
        filename: 'a.zip',
        content: makeZip([
          { path: 'one.md', content: '# One\n\nBody.' },
          { path: 'two.md', content: '# Two\n\nBody.' },
        ]),
      }),
    ).toThrow(/one\.md, two\.md/);
  });

  it('refuses an archive with no markdown at all', () => {
    expect(() =>
      parseSkillUpload({ filename: 'a.zip', content: makeZip([{ path: 'run.sh', content: 'x' }]) }),
    ).toThrow(/No markdown file/);
  });
});

describe('archive import — hostile archives are refused whole', () => {
  it.each([
    ['path traversal', '../../etc/passwd'],
    ['absolute path', '/etc/passwd'],
    ['windows drive', 'C:\\windows\\system32'],
  ])('refuses %s — even though nothing is ever extracted', (_label, path) => {
    // Skipping just the bad entry would put a reassuring "ignored" line where a
    // refusal belongs: an archive built to escape is not one to keep parsing.
    expect(() =>
      parseSkillUpload({
        filename: 'a.zip',
        content: makeZip([
          { path: 'SKILL.md', content: '# A\n\nBody.' },
          { path, content: 'x' },
        ]),
      }),
    ).toThrow(/Refusing this archive/);
  });

  it('refuses an entry whose header under-declares its expanded size', () => {
    // The bomb shape: a size check that trusts the header, then an inflate that
    // does not. Both the cap and this equality check have to hold.
    expect(() =>
      parseSkillUpload({
        filename: 'a.zip',
        content: makeZip([
          { path: 'SKILL.md', content: '# A\n\n' + 'x'.repeat(50_000), declaredSize: 10 },
        ]),
      }),
    ).toThrow(ValidationError);
  });

  it('refuses an archive with too many entries', () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ path: `f${i}.txt`, content: 'x' }));
    expect(() => parseSkillUpload({ filename: 'a.zip', content: makeZip(many) })).toThrow(
      /201 entries/,
    );
  });

  it('refuses an entry that expands past the per-entry cap', () => {
    expect(() =>
      parseSkillUpload({
        filename: 'a.zip',
        content: makeZip([{ path: 'SKILL.md', content: 'x'.repeat(1024 * 1024 + 1) }]),
      }),
    ).toThrow(/the limit is/);
  });

  it('refuses an entry whose local header names a different file', () => {
    // Provenance guard: the entry is chosen by its central-directory path, and
    // that path is what the preview reports as `entry_path`. A crafted archive
    // whose local header names something else would return a body from a file
    // other than the one the user was told was opened.
    const zip = makeZip([
      { path: 'SKILL.md', content: '# Real\n\nThe body the user is shown.' },
      { path: 'other.txt', content: 'x' },
    ]);
    // Rewrite the FIRST local header's filename in place — same length, so every
    // offset in the archive stays valid and only the name disagrees.
    const at = zip.indexOf(Buffer.from('SKILL.md', 'utf8'));
    Buffer.from('EVIL_.md', 'utf8').copy(zip, at);

    expect(() => parseSkillUpload({ filename: 'a.zip', content: zip })).toThrow(
      /disagrees with its local header/,
    );
  });

  it('refuses something that is not a ZIP at all', () => {
    expect(() =>
      parseSkillUpload({ filename: 'a.zip', content: Buffer.from('not a zip file at all') }),
    ).toThrow(ValidationError);
  });
});

describe('splitFrontmatter', () => {
  it('is a flat key:value reader, not a YAML parser', () => {
    const { body, frontmatter } = splitFrontmatter(
      '---\nname: a\ndescription: "quoted value"\nnested:\n  key: v\n---\nBody.',
    );
    expect(frontmatter.name).toBe('a');
    expect(frontmatter.description).toBe('quoted value');
    // A structured value is not something we would store; it is recorded as a
    // key (and therefore reported as dropped) with an empty value, never parsed.
    expect(frontmatter.nested).toBe('');
    expect(body).toBe('Body.');
  });

  it('leaves a body with no frontmatter untouched', () => {
    expect(splitFrontmatter('# Title\n\nBody.').frontmatter).toEqual({});
    expect(splitFrontmatter('# Title\n\nBody.').body).toBe('# Title\n\nBody.');
  });

  it('treats an unterminated frontmatter fence as body, not as metadata', () => {
    const { body, frontmatter } = splitFrontmatter('---\nname: a\n\nno closing fence');
    expect(frontmatter).toEqual({});
    expect(body).toContain('no closing fence');
  });
});

describe('slugify', () => {
  it.each([
    ['SKILL.md', 'skill'],
    ['My Fancy Rule', 'my-fancy-rule'],
    ['api__contract--guard', 'api-contract-guard'],
    ['  spaced  ', 'spaced'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
