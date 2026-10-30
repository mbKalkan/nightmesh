import type { ReportStrings, ValidationReport, ViewerStrings } from '../../shared/protocol';
import { inspect, type InspectContext, type Row } from './details';
import { fill } from './format';
import type { Collection } from './gltf';
import { parseKey, type EntryKey } from './outline';
import type { SizeAnalysis } from './sizes';
import type { Statistics } from './statistics';

/** What a report is made of: the inspector's context and what the tabs show. */
export interface ReportInputs {
  context: InspectContext;
  strings: ViewerStrings;
  statistics: Statistics;
  /** Where the bytes go: for glTF only, as is the validation. */
  size?: SizeAnalysis;
  validation?: ValidationReport;
}

/** Meshes listed in a report, the heaviest first. */
const MESHES = 50;

const COLLECTIONS: Partial<Record<string, Collection>> = {
  mesh: 'meshes',
  texture: 'textures',
  animation: 'animations',
  skin: 'skins',
  node: 'nodes',
  scene: 'scenes',
};

/**
 * A report on the model, to save next to it or share: what the inspector says about the model,
 * its statistics, where its bytes go and what the glTF Validator found. Markdown for people, in
 * the user's language; JSON for tools, with the numbers as they are.
 */
export function buildReport(inputs: ReportInputs): { markdown: string; json: string } {
  return { markdown: markdown(inputs), json: `${JSON.stringify(json(inputs), null, 2)}\n` };
}

function markdown({ context, strings, statistics, size, validation }: ReportInputs): string {
  const { format } = context;
  const text = strings.structure;
  const words: ReportStrings = strings.report;
  const labels = text.labels;
  const name = (key: EntryKey) => escape(entryName(context, strings, key));
  const lines: string[] = [`# ${escape(context.file.name)}`, '', `_${words.generated}_`];
  const heading = (title: string, level = 2) => lines.push('', `${'#'.repeat(level)} ${title}`, '');
  const item = (label: string, value: string) => lines.push(`- ${label}: ${value}`);
  const table = (head: string[], rows: string[][], right: number[] = []) => {
    lines.push(`| ${head.join(' | ')} |`);
    lines.push(`|${head.map((_, i) => (right.includes(i) ? ' ---: ' : ' --- ')).join('|')}|`);
    for (const row of rows) lines.push(`| ${row.map(cell).join(' | ')} |`);
  };

  // The model as the inspector has it: its asset, file, contents and extensions.
  for (const section of inspect(context, 'model')?.sections ?? []) {
    heading(section.title, section.title === text.kinds.model ? 2 : 3);
    for (const row of section.rows) lines.push(`- ${rowText(row)}`);
  }

  heading(text.statistics);
  lines.push(`_${text.statisticsNote}_`, '');
  item(labels.nodes, format.count(statistics.nodes));
  item(labels.instances, format.count(statistics.instances));
  item(labels.drawCalls, format.count(statistics.drawCalls));
  item(labels.vertices, format.count(statistics.vertices));
  for (const shape of ['triangles', 'lines', 'points'] as const) {
    if (statistics[shape] > 0 || shape === 'triangles') {
      item(labels[shape], format.count(statistics[shape]));
    }
  }
  item(text.groups.materials, format.count(statistics.materials));
  item(text.groups.textures, format.count(statistics.textures));
  if (statistics.textureMemory !== undefined) {
    item(labels.textureMemory, `≈ ${format.bytes(statistics.textureMemory)}`);
  }
  if (statistics.bounds) {
    const { min, max } = statistics.bounds;
    item(labels.dimensions, format.dimensions(max.map((value, axis) => value - min[axis])));
  }
  if (statistics.meshes.length > 0) {
    heading(text.groups.meshes, 3);
    const meshes = [...statistics.meshes]
      .sort((a, b) => b.triangles * b.instances - a.triangles * a.instances || a.mesh - b.mesh)
      .slice(0, MESHES);
    table(
      [text.kinds.mesh, labels.instances, labels.triangles, labels.total],
      meshes.map((row) => [
        name(`mesh:${row.mesh}`),
        format.count(row.instances),
        format.count(row.triangles),
        format.count(row.triangles * row.instances),
      ]),
      [1, 2, 3],
    );
    if (statistics.meshes.length > MESHES) {
      lines.push('', fill(labels.more, format.count(statistics.meshes.length - MESHES)));
    }
  }

  // A model read from OBJ, STL or PLY has no glTF file to size or validate.
  if (!size) return `${lines.join('\n')}\n`;
  const sizes = strings.size;
  const share = (bytes: number) =>
    `${size.total > 0 ? Math.round((bytes / size.total) * 100) : 0}%`;
  heading(sizes.tab);
  const total = format.bytes(size.total);
  lines.push(
    `**${size.files === 1 ? fill(sizes.totalOne, total) : fill(sizes.totalMany, total, format.count(size.files))}**`,
    '',
  );
  table(
    [sizes.breakdown, labels.size, words.share],
    size.categories.map(({ category, bytes }) => [
      sizes.categories[category],
      format.bytes(bytes),
      share(bytes),
    ]),
    [1, 2],
  );
  heading(sizes.compression, 3);
  const { compression } = size;
  const geometry = [
    compression.draco > 0 &&
      fill(sizes.draco, format.count(compression.draco), format.count(compression.primitives)),
    compression.meshopt > 0 &&
      fill(sizes.meshopt, format.count(compression.meshopt), format.count(compression.views)),
    compression.quantized && sizes.quantized,
  ].filter((part): part is string => typeof part === 'string');
  item(sizes.geometry, geometry.join(', ') || sizes.none);
  const textures = Object.entries(compression.textures)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${format.count(count)} ${kind.toUpperCase()}`);
  item(sizes.categories.textures, textures.join(', ') || sizes.none);
  heading(sizes.gpuMemory, 3);
  item(sizes.geometry, `≈ ${format.bytes(size.gpuMemory.geometry)}`);
  item(sizes.categories.textures, `≈ ${format.bytes(size.gpuMemory.textures)}`);
  if (size.largest.length > 0) {
    heading(sizes.largest, 3);
    table(
      [words.name, labels.size, words.share],
      size.largest.map(({ key, bytes }) => [name(key), format.bytes(bytes), share(bytes)]),
      [1, 2],
    );
  }
  if (size.images.length > 0) {
    heading(sizes.images, 3);
    table(
      [words.name, words.format, words.pixels, labels.size, labels.gpuMemory, words.notes],
      size.images.map((image) => [
        escape(image.name || `${text.kinds.image} ${image.image}`),
        image.info?.format.toUpperCase() ?? '',
        image.info ? `${image.info.width} × ${image.info.height}` : '',
        image.bytes === undefined ? '' : format.bytes(image.bytes),
        image.gpuMemory === undefined ? '' : `≈ ${format.bytes(image.gpuMemory)}`,
        [
          ...image.warnings.map((warning) => sizes.imageWarnings[warning]),
          ...(image.texture === undefined ? [sizes.unusedImage] : []),
        ].join(' '),
      ]),
      [3, 4],
    );
  }
  if (size.suggestions.length > 0) {
    heading(sizes.suggestions, 3);
    lines.push(`_${sizes.suggestionsNote}_`);
    for (const suggestion of size.suggestions) {
      const said = sizes.suggestion[suggestion.kind];
      lines.push(
        '',
        `**${said.title}.** ${fill(said.text, format.bytes(suggestion.bytes))}`,
        '',
        '```sh',
        suggestion.command,
        '```',
      );
    }
  }

  const checks = strings.validation;
  heading(checks.tab);
  if (!validation) {
    lines.push(words.notValidated);
  } else {
    lines.push(fill(checks.validator, validation.validator), '');
    for (const severity of ['error', 'warning', 'info', 'hint'] as const) {
      item(checks.severities[severity], format.count(validation.counts[severity]));
    }
    if (validation.issues.length > 0) {
      lines.push('');
      table(
        [words.severity, words.code, words.message, words.where],
        validation.issues.map((issue) => [
          checks.severity[issue.severity],
          code(issue.code),
          escape(issue.message),
          issue.pointer !== undefined
            ? code(issue.pointer || '/')
            : issue.offset !== undefined
              ? fill(checks.offset, issue.offset)
              : '',
        ]),
      );
    }
    if (validation.truncated) {
      lines.push('', fill(checks.truncated, format.count(validation.issues.length)));
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The report for tools: numbers as they are, entries by key and name. */
function json({ context, strings, statistics, size, validation }: ReportInputs): unknown {
  const { model, file } = context;
  const name = (key: EntryKey) => entryName(context, strings, key);
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  const meshes = statistics.meshes.map((row) => ({ ...row, name: name(`mesh:${row.mesh}`) }));
  if (!size) {
    return {
      file: { name: file.name, bytes: file.size, format: file.container },
      source: context.source ?? null,
      // Lengths in the file's own unit.
      check: context.check ? { ...context.check, unit: context.format.lengthUnit } : null,
      statistics: { ...statistics, meshes },
    };
  }
  return {
    file: { name: file.name, bytes: file.size, container: file.container, chunks: file.chunks },
    asset: model.root.asset ?? {},
    extensionsUsed: list(model.root.extensionsUsed),
    extensionsRequired: list(model.root.extensionsRequired),
    statistics: { ...statistics, meshes },
    size: {
      ...size,
      largest: size.largest.map((entry) => ({ ...entry, name: name(entry.key) })),
    },
    validation: validation ?? null,
  };
}

/** An entry's name, or its kind and index when it has none. */
function entryName(context: InspectContext, strings: ViewerStrings, key: EntryKey): string {
  const parsed = parseKey(key);
  if (!parsed) return key;
  const collection = COLLECTIONS[parsed.kind];
  return (
    (collection && context.model.displayName(collection, parsed.index)) ??
    `${strings.structure.kinds[parsed.kind]} ${parsed.index}`
  );
}

/** An inspector row as a line of text: its label, value, links and note. */
export function rowText(row: Row): string {
  const value = [
    row.text !== undefined ? escape(row.text) : undefined,
    row.links?.map((link) => escape(link.text)).join(', '),
    row.json !== undefined ? `\`${row.json.replace(/\s+/g, ' ')}\`` : undefined,
    row.note !== undefined ? `(${escape(row.note)})` : undefined,
  ]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
  return row.label ? `${escape(row.label)}: ${value}` : value;
}

/** Text from the model, which Markdown would otherwise read as formatting. */
export function escape(text: string): string {
  return text.replace(/[\\`*<|]/g, '\\$&').replace(/\r?\n/g, ' ');
}

/** A table cell: one line. Text from the model in it is escaped already. */
export function cell(text: string): string {
  return text.replace(/\r?\n/g, ' ');
}

/** Text in a code span, in a table too: GitHub ends a cell at a bare `|` even there. */
export function code(text: string): string {
  return `\`${text.replace(/`/g, "'").replace(/\|/g, '\\|')}\``;
}
