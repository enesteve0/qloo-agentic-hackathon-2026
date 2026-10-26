import 'server-only';
import { z } from 'zod';

/**
 * Loose schemas for raw Qloo payloads. They ignore extra fields, turn malformed optional values into
 * null (`.catch`) and only insist on what we cannot work without (ids, names, cell locations). Items
 * are parsed one by one so a single odd record never fails a whole response.
 */

const num = z.number().nullish().catch(null);
const str = z.string().nullish().catch(null);

export const TagSchema = z.object({
  id: str,
  tag_id: str,
  name: str,
  type: str,
  subtype: str,
  value: str,
  affinity: num,
  query: z.object({ affinity: num }).nullish().catch(null),
});

const LatLonSchema = z
  .object({ lat: num, lon: num, latitude: num, longitude: num, geohash: str })
  .nullish()
  .catch(null);

/** Entity from /search, /entities or insights `results.entities[]` (`type`+`subtype` or `types[]`). */
export const EntitySchema = z.object({
  entity_id: z.string().min(1),
  name: z.string().min(1),
  type: str,
  subtype: str,
  types: z.array(z.string()).nullish().catch(null),
  popularity: num,
  disambiguation: str,
  location: LatLonSchema,
  properties: z.record(z.string(), z.unknown()).nullish().catch(null),
  tags: z.array(z.unknown()).nullish().catch(null),
  query: z
    .object({ affinity: num, explainability: z.record(z.string(), z.unknown()).nullish().catch(null) })
    .nullish()
    .catch(null),
});

/** /search and /entities: flat top-level `results[]` (a nested `results.entities[]` is also accepted). */
export const SearchResponseSchema = z.object({
  results: z.union([z.array(z.unknown()), z.object({ entities: z.array(z.unknown()) })]),
});

export const LocalitySchema = z.object({ entity_id: str, id: str, name: str, disambiguation: str });

/** Locality echo for `filter.location.query`: an object or an array depending on the request. */
const QueryEchoSchema = z
  .object({
    localities: z
      .object({ filter: z.union([LocalitySchema, z.array(LocalitySchema)]).nullish().catch(null) })
      .nullish()
      .catch(null),
  })
  .nullish()
  .catch(null);

export const HeatCellSchema = z.object({
  location: z.object({ latitude: num, longitude: num, lat: num, lon: num, geohash: str }),
  query: z.object({ affinity: num, affinity_rank: num, popularity: num }).nullish().catch(null),
});

export const HeatmapResponseSchema = z.object({
  results: z.object({ heatmap: z.array(z.unknown()).nullish() }),
  query: QueryEchoSchema,
});

export const EntityInsightsResponseSchema = z.object({
  results: z.object({ entities: z.array(z.unknown()).nullish() }),
});

export const TagInsightsResponseSchema = z.object({
  results: z.object({ tags: z.array(z.unknown()).nullish() }),
});

export const DemographicsItemSchema = z.object({
  entity_id: z.string().min(1),
  query: z
    .object({
      age: z.record(z.string(), num).nullish().catch(null),
      gender: z.record(z.string(), num).nullish().catch(null),
    })
    .nullish()
    .catch(null),
});

export const DemographicsResponseSchema = z.object({
  results: z.object({ demographics: z.array(z.unknown()).nullish() }),
});

export const RootResponseSchema = z
  .object({ name: str, version: str, api_version: str })
  .catch({ name: null, version: null, api_version: null });

/** Error bodies: 429 `{error_msg}`, 400 `{errors:[{message,path}]}`, 403/401 `{message}` or `{error}`. */
export const ErrorBodySchema = z.object({
  error_msg: str,
  message: str,
  detail: str,
  error: z
    .union([z.string(), z.object({ message: str })])
    .nullish()
    .catch(null),
  errors: z
    .array(
      z.object({
        message: str,
        path: z
          .union([z.string(), z.array(z.union([z.string(), z.number()]))])
          .nullish()
          .catch(null),
      }),
    )
    .nullish()
    .catch(null),
});
