# Geolocation, Google Map, and Radius Integration

This document describes the clinical-trial location customization added to the
upstream LangChain Agent Chat UI.

## Product flow

1. The Python graph decides that trial matching needs a search location.
2. The graph returns `request_user_location: true`.
3. The frontend asks the browser for geolocation.
4. If permission is granted, the frontend shows a Google Maps JavaScript map
   centered on the browser location.
5. The card places a marker on the selected location.
6. The user may select an optional radius; when selected, the card draws a
   circle around the marker.
7. The user can click **Change location** to use Google Places Autocomplete
   instead of browser geolocation.
   The backend can also return `location_search_query` after a chat prompt such
   as `change location to UBC`; in that case the same card opens with the query
   prefilled.
8. The user confirms with **Use this location**.
9. The frontend submits normalized location state and optional `radius_miles`
   back to the same LangGraph thread.
10. The backend sorts studies by nearest known listed site with PostGIS.
11. Study matches render as clickable cards. Maps are lazy-loaded and only
    appear after **Show location on map** is clicked.
12. The backend stores each rendered result list in `study_result_snapshots`,
    keyed by the assistant message ID for the `"Study matches"` message.
13. Follow-up controls such as **Ask about this study**, **Start a new study
    search**, and **Adjust location or radius** submit structured graph updates
    instead of duplicating location/radius values in chat text.

If browser geolocation fails or is denied, the card falls back to location entry.
With a Google Maps browser key, this uses Places Autocomplete. Without a browser
key, it falls back to a plain typed location field inside the location card.

The UI should use location/distance language carefully. ClinicalTrials.gov
locations are often listed-site hints rather than navigation-grade coordinates,
so cards label the returned miles as approximate distance from the listed study
site and keep "Closest listed site" language. These values are not Google Maps
travel-route distances or guaranteed exact facility-address distances.

The public distance field is `estimated_site_distance_miles`. The backend keeps
the canonical PostGIS meter value internal as `distance_meters` for sorting,
radius checks, and `outside_radius`. Do not reintroduce generic `distance_miles`
copy; if Google route distance is added later, use a separate lazy-loaded route
field.

The backend filters participation searches to study-level `RECRUITING` or
`ENROLLING_BY_INVITATION` records. For each study, nearest-site selection
prefers local site statuses with those same values before falling back to the
nearest geocoded listed site. The UI should display `location_status` when
present because the closest fallback site may not itself be recruiting.

## Environment

The frontend needs a browser-restricted Google Maps key:

```text
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=...
```

Enable at least:

- Maps JavaScript API
- Places API

If you use the newer Places API controls in Google Cloud, enable the relevant
Places API variant for the key. The frontend key must be a browser key, not the
server geocoding key.

Restrict this key by HTTP referrer because it is intentionally exposed to the
browser. Keep backend geocoding on a separate server key such as
`GOOGLE_MAPS_API_KEY`.

## Frontend state contract

The UI reads:

```json
{
  "request_user_location": true
}
```

The UI submits a normalized location object:

```json
{
  "user_location": {
    "latitude": 49.2827,
    "longitude": -123.1207,
    "accuracy": 100,
    "label": "Current location",
    "provider": "browser_geolocation"
  },
  "slots": {
    "location": {
      "latitude": 49.2827,
      "longitude": -123.1207,
      "accuracy": 100,
      "label": "Current location",
      "provider": "browser_geolocation"
    },
    "location_confirmed": true,
    "radius_miles": 25
  }
}
```

When the user chooses a Google Places result, `user_location.provider` becomes
`google_places` and `provider_place_id` is included when Google provides one.
The autocomplete flow creates a Places session token when **Change location**
starts, reuses it for predictions, consumes it on the selected place details
request, then discards it.

The graph/backend should treat provider fields as metadata. Ranking only needs
`latitude`, `longitude`, and optional `radius_miles`.

Legacy thread state may still contain top-level `slots.latitude` and
`slots.longitude`, but new submissions should keep coordinates inside
`slots.location`.

Study result payloads use:

```json
{
  "trial_count": 12,
  "trial_matches": [
    {
      "id": "NCT00000000",
      "title": "Example study",
      "location": "Example Hospital, Vancouver, BC, Canada",
      "location_status": "RECRUITING",
      "latitude": 49.2827,
      "longitude": -123.1207,
      "estimated_site_distance_miles": 4.2,
      "outside_radius": false,
      "contact_name": "Local site contact",
      "contact_phone": "+1 555 0100",
      "contact_email": "site@example.org",
      "study_contact_name": "Central contact",
      "study_contact_phone": "+1 555 0101",
      "study_contact_email": "study@example.org",
      "raw_json": {
        "protocolSection": {}
      }
    }
  ],
  "study_result_snapshots": {
    "<assistant-message-id>": {
      "trial_count": 12,
      "trial_matches": [
        {
          "id": "NCT00000000",
          "estimated_site_distance_miles": 4.2
        }
      ],
      "filters": {
        "condition": "example condition",
        "radius_miles": 25
      }
    }
  }
}
```

The frontend prefers `study_result_snapshots[message.id]` for each `"Study
matches"` assistant message, with a local React snapshot fallback for active
streaming. This keeps separate study lists stable in the transcript.

## Files

- `src/components/thread/location-request.tsx`
  - Browser geolocation request.
  - Google Maps script loading.
  - Map rendering.
  - Marker and radius circle.
  - Google Places Autocomplete for change-location.
  - Structured submission into LangGraph state.
- `src/providers/Stream.tsx`
  - Adds TypeScript state/update types for `user_location` and `slots`.
- `src/components/thread/index.tsx`
  - Renders `<LocationRequest />` above the chat composer.
  - Renders suggested options as chips.
  - Renders known user filters in collapsed "What I know so far".
  - Renders study result cards from backend/local snapshots.
  - Opens the selected study in a fullscreen modal.
  - Extracts `raw_json` into readable modal sections: Overview, Eligibility,
    Locations & contacts, Study design, Outcomes, and Dates.
  - Groups outcome rows under Primary outcomes, Secondary outcomes, and Other
    outcomes.
  - Renders `raw_json` as formatted ClinicalTrials.gov JSON when present.
  - Keeps raw JSON available for safety/adverse-event inspection because safety
    language can appear in descriptions, outcomes, eligibility, arms, or
    official observed adverse-event results.
  - Submits hidden `do-not-render-*` focus messages for **Ask about this
    study**.
  - Lazy-loads the map with **Show location on map**.
- `.env.example`
  - Declares `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`.

## Safety/adverse-event display note

ClinicalTrials.gov safety language is not always observed side-effect data.
Protocol sections may say a study will measure adverse events or assess safety
and tolerability. That is planned monitoring, not necessarily an event that
happened. Actual observed adverse-event results are under
`resultsSection.adverseEventsModule` when the study has posted results.

The fullscreen study modal includes **Ask about side effects & safety**. That
prompt sends the selected NCT ID and asks the backend to search the raw study
record in this order:

- `resultsSection.adverseEventsModule`
- `protocolSection.outcomesModule`
- `protocolSection.descriptionModule`
- `protocolSection.eligibilityModule`
- `protocolSection.armsInterventionsModule`
- other study fields only if the preceding sections are not enough

Safety answers should classify record text as observed adverse events, planned
safety monitoring, potential protocol risks, safety-related eligibility
information, or general safety statements. They should also include the source
label, JSON path, and whether each item was observed or only planned.

False positives are possible, including location names such as "Safety Harbor",
psychological phrases such as "safety behaviors", data safety monitoring boards,
occupational safety, references, and data-access review text. UI copy should
distinguish planned safety monitoring, eligibility exclusions, narrative
safety/tolerability text, and observed adverse-event results.

## HTTPS requirement

Browser geolocation requires a secure context. It works on:

- `https://...`
- `http://localhost`

It usually does not work from an iPad pointed at another computer's plain
`http://192.168...` address. For iPad testing, serve the frontend over HTTPS
or deploy it to a service such as Vercel.

## Troubleshooting

If no permission popup appears:

- Confirm the graph returned `request_user_location: true`.
- Confirm the location card is visible.
- Confirm the frontend origin is HTTPS or localhost.
- Check browser/site location permissions.

If the map or autocomplete does not load:

- Confirm `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is set before starting Next.js.
- Confirm the key allows the current frontend origin.
- Confirm Maps JavaScript API and Places API are enabled.
- Check the browser console for Google Maps key/restriction errors.

If coordinates submit but ranking does not happen:

- Confirm the frontend is connected to graph ID `rag`.
- Confirm the LangGraph server URL is current.
- Restart the backend after graph code changes.
- Confirm backend state accepts `user_location` and `slots.radius_miles`.

If the study cards do not appear:

- Confirm the backend response contains `trial_matches`.
- Confirm the `"Study matches"` assistant message has an ID that matches a
  `study_result_snapshots` key.
- Restart the frontend after TypeScript component changes.
- Start a fresh thread if the old thread state was created before
  `trial_matches` existed.

## Current limitations

- Browser geolocation labels are `"Current location"` unless the user switches
  through Places Autocomplete. The backend may reverse-geocode exact browser
  coordinates if it needs a richer label.
- Radius is a preset/custom miles input, not a draggable map radius handle.
- Study maps use embedded Google Maps iframe URLs, not a custom marker/radius
  map yet.
- The fullscreen study modal displays the fields currently returned in each
  `trial_match`, readable sections extracted from `raw_json`, plus formatted
  raw JSON when present. Returning raw JSON on every match is acceptable for the
  prototype but may become heavy with large result sets; move it behind lazy NCT
  detail loading if payload size becomes a problem.
- Google route distance/time is not calculated yet. Adding it would require
  extra Google Routes/Distance Matrix calls and should be lazy-loaded separately
  from `estimated_site_distance_miles`.
- Temporary Cloudflare tunnel URLs are development-only and change on restart.
