import {
  OP_SET,
  OP_REMOVE,
  OP_TRUNCATE,
  OP_APPEND,
  OP_ASSIGN,
  OP_STRING_SPLICE,
  OP_ARRAY_SPLICE,
  OP_ARRAY_MOVE,
  OP_STRING_COPY,
  OP_ARRAY_ASSIGN,
  OP_ARRAY_OBJECT_ASSIGN,
  OP_ARRAY_TUPLE_ASSIGN,
  OP_ARRAY_OBJECT_FIELD_ASSIGN,
  OP_SCALAR_ARRAY_REPLACE,
  OP_ARRAY_TWO_FIELD_INSERT
} from '@shapeshift-labs/frontier/constants';
import { assertPatch } from '@shapeshift-labs/frontier/patch';
import type { JsonPath, MapPathOptions, Patch, TextPosition } from './types.js';

export function mapPath(path: JsonPath, patch: Patch, options?: MapPathOptions): JsonPath | null {
  assertPath(path);
  if (!options || options.validate !== false) assertPatch(patch);

  let mapped = path.slice();
  for (let i = 0, length = patch.length; i < length; i++) {
    mapped = mapPathThroughOperation(mapped, patch[i], options);
    if (mapped === null) return null;
  }
  return mapped;
}

export function mapTextPosition(path: JsonPath, offset: number, patch: Patch, options?: MapPathOptions): TextPosition | null {
  assertPath(path);
  assertOffset(offset);
  if (!options || options.validate !== false) assertPatch(patch);

  let mappedPath = path.slice();
  let mappedOffset = offset;
  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i];
    const code = op[0];
    const opPath = op[1];

    if (code === OP_STRING_SPLICE && samePath(mappedPath, opPath)) {
      mappedOffset = mapOffsetThroughSplice(mappedOffset, op[2], op[3], op[4].length, options);
      if (mappedOffset === null) return null;
      continue;
    }

    if (code === OP_STRING_COPY && samePath(mappedPath, opPath)) {
      mappedOffset = mapOffsetThroughSplice(mappedOffset, op[2], 0, op[4], options);
      if (mappedOffset === null) return null;
      continue;
    }

    if (invalidatesTextPosition(mappedPath, op)) return null;

    mappedPath = mapPathThroughOperation(mappedPath, op, options);
    if (mappedPath === null) return null;
  }

  return {
    path: mappedPath,
    offset: mappedOffset
  };
}

export function mapTextPositions(positions: TextPosition[], patch: Patch, options?: MapPathOptions): Array<TextPosition | null> {
  if (!Array.isArray(positions)) throw new TypeError('positions must be an array');
  if (positions.length === 1) {
    const position = positions[0];
    if (position === null || typeof position !== 'object') throw new TypeError('positions[0] must be a text position');
    return [mapTextPosition(position.path, position.offset, patch, options)];
  }

  const offsets = new Array(positions.length);
  const alive = new Array(positions.length);
  const groups: Array<{ path: JsonPath | null; indexes: number[] }> = [];
  const groupByPath = new Map<string, { path: JsonPath | null; indexes: number[] }>();
  let lastGroup: { path: JsonPath | null; indexes: number[] } | undefined;

  for (let i = 0, length = positions.length; i < length; i++) {
    const position = positions[i];
    if (position === null || typeof position !== 'object') throw new TypeError('positions[' + i + '] must be a text position');
    assertPath(position.path);
    assertOffset(position.offset);
    offsets[i] = position.offset;
    alive[i] = true;

    let group = lastGroup;
    if (group === undefined || group.path === null || !samePath(group.path, position.path)) {
      const key = JSON.stringify(position.path);
      group = groupByPath.get(key);
      if (group === undefined) {
        group = { path: position.path.slice(), indexes: [] };
        groupByPath.set(key, group);
        groups[groups.length] = group;
      }
      lastGroup = group;
    }
    group.indexes[group.indexes.length] = i;
  }
  if (!options || options.validate !== false) assertPatch(patch);

  const out = new Array(positions.length);

  for (let opIndex = 0, opCount = patch.length; opIndex < opCount; opIndex++) {
    const op = patch[opIndex];
    const code = op[0];
    const opPath = op[1];

    for (let groupIndex = 0, groupCount = groups.length; groupIndex < groupCount; groupIndex++) {
      const group = groups[groupIndex];
      const mappedPath = group.path;
      if (mappedPath === null) continue;
      const indexes = group.indexes;

      if (code === OP_STRING_SPLICE && samePath(mappedPath, opPath)) {
        for (let i = 0, length = indexes.length; i < length; i++) {
          const index = indexes[i];
          if (!alive[index]) continue;
          const mappedOffset = mapOffsetThroughSplice(offsets[index], op[2], op[3], op[4].length, options);
          if (mappedOffset === null) {
            alive[index] = false;
          } else {
            offsets[index] = mappedOffset;
          }
        }
        continue;
      }

      if (code === OP_STRING_COPY && samePath(mappedPath, opPath)) {
        for (let i = 0, length = indexes.length; i < length; i++) {
          const index = indexes[i];
          if (!alive[index]) continue;
          const mappedOffset = mapOffsetThroughSplice(offsets[index], op[2], 0, op[4], options);
          if (mappedOffset === null) {
            alive[index] = false;
          } else {
            offsets[index] = mappedOffset;
          }
        }
        continue;
      }

      if (invalidatesTextPosition(mappedPath, op)) {
        group.path = null;
        for (let i = 0, length = indexes.length; i < length; i++) {
          alive[indexes[i]] = false;
        }
        continue;
      }

      group.path = mapPathThroughOperation(mappedPath, op, options);
      if (group.path === null) {
        for (let i = 0, length = indexes.length; i < length; i++) {
          alive[indexes[i]] = false;
        }
      }
    }
  }

  for (let groupIndex = 0, groupCount = groups.length; groupIndex < groupCount; groupIndex++) {
    const group = groups[groupIndex];
    const indexes = group.indexes;
    for (let i = 0, length = indexes.length; i < length; i++) {
      const index = indexes[i];
      out[index] = !alive[index] || group.path === null ? null : {
        path: group.path.slice(),
        offset: offsets[index]
      };
    }
  }
  return out;
}

function mapPathThroughOperation(path, op, options) {
  const code = op[0];
  const opPath = op[1];

  if (code === OP_SET || code === OP_SCALAR_ARRAY_REPLACE) {
    if (samePath(path, opPath)) return path;
    return isAncestor(opPath, path) ? null : path;
  }

  if (code === OP_REMOVE) {
    const parentLength = opPath.length - 1;
    const removedKey = opPath[opPath.length - 1];
    if (samePath(path, opPath) || isAncestor(opPath, path)) return null;
    if (
      opPath.length > 0 &&
      startsWithPath(path, opPath, parentLength) &&
      typeof removedKey === 'number' &&
      typeof path[parentLength] === 'number' &&
      path[parentLength] > removedKey
    ) {
      return withSegment(path, parentLength, path[parentLength] - 1);
    }
    return path;
  }

  if (code === OP_ASSIGN) {
    if (isAssignedDescendant(path, opPath, op[2], false)) return null;
    return path;
  }

  if (code === OP_TRUNCATE) {
    return mapArrayPath(path, opPath, op[2], Infinity, 0, options);
  }

  if (code === OP_APPEND) {
    return path;
  }

  if (code === OP_ARRAY_SPLICE) {
    return mapArrayPath(path, opPath, op[2], op[3], op[4].length, options);
  }

  if (code === OP_ARRAY_TWO_FIELD_INSERT) {
    return mapArrayPath(path, opPath, op[2], 0, op[5].length, options);
  }

  if (code === OP_ARRAY_MOVE) {
    return mapArrayMovePath(path, opPath, op[2], op[3]);
  }

  if (code === OP_ARRAY_ASSIGN) {
    return mapArrayAssignPath(path, opPath, op[2]);
  }

  if (code === OP_ARRAY_OBJECT_ASSIGN) {
    return mapArrayObjectAssignPath(path, opPath, op[2], op[3]);
  }

  if (code === OP_ARRAY_TUPLE_ASSIGN) {
    return mapArrayTupleAssignPath(path, opPath, op[2], op[3]);
  }

  if (code === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
    return mapArrayObjectFieldAssignPath(path, opPath, op[2], op[3]);
  }

  return path;
}

function mapArrayPath(path, arrayPath, start, deleteCount, insertCount, options) {
  if (!startsWithPath(path, arrayPath) || path.length === arrayPath.length) return path;

  const indexOffset = arrayPath.length;
  const index = path[indexOffset];
  if (typeof index !== 'number') return path;
  if (index < start) return path;

  const end = start + deleteCount;
  if (index >= end) return withSegment(path, indexOffset, index + insertCount - deleteCount);

  const deleted = deletedMapping(options);
  if (deleted === 'start') return withSegment(path, indexOffset, start);
  if (deleted === 'end') return withSegment(path, indexOffset, start + insertCount);
  return null;
}

function mapArrayMovePath(path, arrayPath, from, to) {
  if (from === to || !startsWithPath(path, arrayPath) || path.length === arrayPath.length) return path;

  const indexOffset = arrayPath.length;
  const index = path[indexOffset];
  if (typeof index !== 'number') return path;

  if (index === from) return withSegment(path, indexOffset, to);
  if (from < to && index > from && index <= to) return withSegment(path, indexOffset, index - 1);
  if (to < from && index >= to && index < from) return withSegment(path, indexOffset, index + 1);
  return path;
}

function mapArrayAssignPath(path, arrayPath, indexes) {
  if (!startsWithPath(path, arrayPath) || path.length === arrayPath.length) return path;

  const indexOffset = arrayPath.length;
  const index = path[indexOffset];
  if (typeof index !== 'number' || indexOfNumber(indexes, index) < 0) return path;
  return path.length === indexOffset + 1 ? path : null;
}

function mapArrayObjectAssignPath(path, arrayPath, indexes, values) {
  if (!startsWithPath(path, arrayPath) || path.length <= arrayPath.length + 1) return path;

  const indexOffset = arrayPath.length;
  const indexPosition = indexOfNumber(indexes, path[indexOffset]);
  if (typeof path[indexOffset] !== 'number' || indexPosition < 0) return path;

  const assigned = values[indexPosition];
  const keyOffset = indexOffset + 1;
  if (!hasOwn(assigned, path[keyOffset])) return path;
  return path.length === keyOffset + 1 ? path : null;
}

function mapArrayTupleAssignPath(path, arrayPath, rowIndexes, fieldIndexes) {
  if (!startsWithPath(path, arrayPath) || path.length <= arrayPath.length + 1) return path;

  const indexOffset = arrayPath.length;
  const rowIndex = path[indexOffset];
  if (typeof rowIndex !== 'number') return path;

  const fieldOffset = indexOffset + 1;
  for (let i = 0, length = rowIndexes.length; i < length; i++) {
    if (rowIndexes[i] === rowIndex && fieldIndexes[i] === path[fieldOffset]) {
      return path.length === fieldOffset + 1 ? path : null;
    }
  }
  return path;
}

function mapArrayObjectFieldAssignPath(path, arrayPath, rowIndexes, fields) {
  if (!startsWithPath(path, arrayPath) || path.length <= arrayPath.length + 1) return path;

  const indexOffset = arrayPath.length;
  const rowIndex = path[indexOffset];
  if (typeof rowIndex !== 'number' || indexOfNumber(rowIndexes, rowIndex) < 0) return path;

  const fieldOffset = indexOffset + 1;
  for (let i = 0, length = fields.length; i < length; i++) {
    const field = fields[i];
    if (pathStartsWithField(path, fieldOffset, field)) {
      return path.length === fieldOffset + field.length ? path : null;
    }
  }
  return path;
}

function mapOffsetThroughSplice(offset, start, deleteCount, insertLength, options) {
  const end = start + deleteCount;
  if (offset < start) return offset;
  if (offset > end) return offset + insertLength - deleteCount;

  if (deleteCount === 0) {
    return assoc(options) < 0 ? offset : offset + insertLength;
  }

  const deleted = deletedMapping(options);
  if (deleted === 'start') return start;
  if (deleted === 'end') return start + insertLength;
  return null;
}

function invalidatesTextPosition(path, op) {
  const code = op[0];
  const opPath = op[1];

  if (code === OP_SET || code === OP_SCALAR_ARRAY_REPLACE || code === OP_REMOVE) {
    return samePath(path, opPath) || isAncestor(opPath, path);
  }

  if (code === OP_ASSIGN) {
    return isAssignedDescendant(path, opPath, op[2], true);
  }

  if (code === OP_ARRAY_ASSIGN) {
    return isArrayAssignedDescendant(path, opPath, op[2], true);
  }

  if (code === OP_ARRAY_OBJECT_ASSIGN) {
    return isArrayObjectAssignedDescendant(path, opPath, op[2], op[3], true);
  }

  if (code === OP_ARRAY_TUPLE_ASSIGN) {
    return isArrayTupleAssignedDescendant(path, opPath, op[2], op[3], true);
  }

  if (code === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
    return isArrayObjectFieldAssignedDescendant(path, opPath, op[2], op[3], true);
  }

  return false;
}

function isArrayAssignedDescendant(path, opPath, indexes, includeExact) {
  const indexOffset = opPath.length;
  if (path.length <= indexOffset || !startsWithPath(path, opPath)) return false;
  if (typeof path[indexOffset] !== 'number' || indexOfNumber(indexes, path[indexOffset]) < 0) return false;
  return includeExact || path.length > indexOffset + 1;
}

function isArrayObjectAssignedDescendant(path, opPath, indexes, values, includeExact) {
  const indexOffset = opPath.length;
  if (path.length <= indexOffset + 1 || !startsWithPath(path, opPath)) return false;
  if (typeof path[indexOffset] !== 'number') return false;
  const indexPosition = indexOfNumber(indexes, path[indexOffset]);
  if (indexPosition < 0) return false;
  if (!hasOwn(values[indexPosition], path[indexOffset + 1])) return false;
  return includeExact || path.length > indexOffset + 2;
}

function isArrayTupleAssignedDescendant(path, opPath, rowIndexes, fieldIndexes, includeExact) {
  const indexOffset = opPath.length;
  if (path.length <= indexOffset + 1 || !startsWithPath(path, opPath)) return false;
  const rowIndex = path[indexOffset];
  if (typeof rowIndex !== 'number') return false;
  const field = path[indexOffset + 1];
  for (let i = 0, length = rowIndexes.length; i < length; i++) {
    if (rowIndexes[i] === rowIndex && fieldIndexes[i] === field) {
      return includeExact || path.length > indexOffset + 2;
    }
  }
  return false;
}

function isArrayObjectFieldAssignedDescendant(path, opPath, rowIndexes, fields, includeExact) {
  const indexOffset = opPath.length;
  if (path.length <= indexOffset + 1 || !startsWithPath(path, opPath)) return false;
  const rowIndex = path[indexOffset];
  if (typeof rowIndex !== 'number' || indexOfNumber(rowIndexes, rowIndex) < 0) return false;
  const fieldOffset = indexOffset + 1;
  for (let i = 0, length = fields.length; i < length; i++) {
    const field = fields[i];
    if (pathStartsWithField(path, fieldOffset, field)) {
      return includeExact || path.length > fieldOffset + field.length;
    }
  }
  return false;
}

function pathStartsWithField(path, offset, field) {
  if (path.length < offset + field.length) return false;
  for (let i = 0, length = field.length; i < length; i++) {
    if (path[offset + i] !== field[i]) return false;
  }
  return true;
}

function isAssignedDescendant(path, opPath, values, includeExact) {
  const keyOffset = opPath.length;
  if (path.length <= keyOffset || !startsWithPath(path, opPath)) return false;
  if (!hasOwn(values, path[keyOffset])) return false;
  return includeExact || path.length > keyOffset + 1;
}

function assertPath(path) {
  if (!Array.isArray(path)) throw new TypeError('path must be an array');
}

function assertOffset(offset) {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('offset must be a non-negative safe integer');
  }
}

function deletedMapping(options) {
  return options && (options.deleted === 'start' || options.deleted === 'end') ? options.deleted : 'null';
}

function assoc(options) {
  return options && options.assoc < 0 ? -1 : 1;
}

function startsWithPath(path, prefix, length?) {
  if (length === undefined) length = prefix.length;
  if (length > path.length || length > prefix.length) return false;
  for (let i = 0; i < length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

function samePath(left, right) {
  return left.length === right.length && startsWithPath(left, right);
}

function isAncestor(ancestor, path) {
  return ancestor.length < path.length && startsWithPath(path, ancestor);
}

function withSegment(path, index, value) {
  const next = path.slice();
  next[index] = value;
  return next;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function indexOfNumber(values, value) {
  for (let i = 0, length = values.length; i < length; i++) {
    if (values[i] === value) return i;
  }
  return -1;
}
