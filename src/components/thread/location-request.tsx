"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, LocateFixed, MapPin, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useStreamContext, type TrialSlots } from "@/providers/Stream";

type LocationStatus = "idle" | "requesting" | "ready" | "manual";
type AutocompleteStatus = "idle" | "loading" | "ready" | "error";

type SelectedLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  label: string;
  provider: "browser_geolocation" | "google_places" | "manual";
  provider_place_id?: string;
};

type GoogleMapsApi = {
  maps: {
    Map: new (
      element: HTMLElement,
      options: {
        center: GoogleLatLngLiteral;
        zoom: number;
        mapTypeControl?: boolean;
        streetViewControl?: boolean;
        fullscreenControl?: boolean;
      },
    ) => GoogleMap;
    Marker: new (options: {
      map: GoogleMap;
      position: GoogleLatLngLiteral;
      title?: string;
    }) => GoogleMarker;
    Circle: new (options: {
      map: GoogleMap;
      center: GoogleLatLngLiteral;
      radius: number;
      fillColor: string;
      fillOpacity: number;
      strokeColor: string;
      strokeOpacity: number;
      strokeWeight: number;
    }) => GoogleCircle;
    Geocoder: new () => GoogleGeocoder;
    places: {
      AutocompleteService: new () => GoogleAutocompleteService;
      AutocompleteSessionToken: new () => GoogleAutocompleteSessionToken;
      PlacesService: new (element: HTMLElement) => GooglePlacesService;
      PlacesServiceStatus: {
        OK: "OK";
      };
    };
  };
};

type GoogleLatLngLiteral = {
  lat: number;
  lng: number;
};

type GoogleMap = {
  setCenter: (center: GoogleLatLngLiteral) => void;
  setZoom: (zoom: number) => void;
};

type GoogleMarker = {
  setPosition: (position: GoogleLatLngLiteral) => void;
  setTitle: (title: string) => void;
};

type GoogleCircle = {
  setCenter: (center: GoogleLatLngLiteral) => void;
  setRadius: (radius: number) => void;
  setMap: (map: GoogleMap | null) => void;
};

type GoogleGeocoder = {
  geocode: (
    request: { location: GoogleLatLngLiteral },
    callback: (
      results: Array<{ formatted_address?: string }> | null,
      status: string,
    ) => void,
  ) => void;
};

type GoogleAutocompleteSessionToken = object;

type GoogleAutocompletePrediction = {
  description: string;
  place_id: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
};

type GoogleAutocompleteService = {
  getPlacePredictions: (
    request: {
      input: string;
      sessionToken: GoogleAutocompleteSessionToken;
    },
    callback: (
      predictions: GoogleAutocompletePrediction[] | null,
      status: string,
    ) => void,
  ) => void;
};

type GooglePlaceDetails = {
  formatted_address?: string;
  name?: string;
  place_id?: string;
  geometry?: {
    location?: {
      lat: () => number;
      lng: () => number;
    };
  };
};

type GooglePlacesService = {
  getDetails: (
    request: {
      placeId: string;
      fields: string[];
      sessionToken: GoogleAutocompleteSessionToken;
    },
    callback: (place: GooglePlaceDetails | null, status: string) => void,
  ) => void;
};

declare global {
  interface Window {
    google?: GoogleMapsApi;
    __ragGoogleMapsPromise?: Promise<GoogleMapsApi>;
  }
}

const GOOGLE_MAPS_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const RADIUS_OPTIONS = [
  { label: "Any distance", value: "" },
  { label: "10 miles", value: "10" },
  { label: "25 miles", value: "25" },
  { label: "50 miles", value: "50" },
  { label: "100 miles", value: "100" },
  { label: "Custom", value: "custom" },
] as const;

function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Google Maps can only load in the browser."),
    );
  }
  if (window.google?.maps?.places) {
    return Promise.resolve(window.google);
  }
  if (!GOOGLE_MAPS_BROWSER_KEY) {
    return Promise.reject(
      new Error("Set NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY to use Google Maps."),
    );
  }
  if (window.__ragGoogleMapsPromise) return window.__ragGoogleMapsPromise;

  window.__ragGoogleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = `__ragGoogleMapsLoaded_${Date.now()}`;
    const script = document.createElement("script");
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.searchParams.set("key", GOOGLE_MAPS_BROWSER_KEY);
    url.searchParams.set("libraries", "places");
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("v", "weekly");

    (window as unknown as Record<string, () => void>)[callbackName] = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      if (!window.google?.maps?.places) {
        reject(new Error("Google Maps loaded without the Places library."));
        return;
      }
      resolve(window.google);
    };

    script.src = url.toString();
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      window.__ragGoogleMapsPromise = undefined;
      reject(new Error("Failed to load Google Maps JavaScript API."));
    };

    document.head.appendChild(script);
  });

  return window.__ragGoogleMapsPromise;
}

function milesToMeters(miles: number) {
  return miles * 1609.344;
}

function parseRadius(value: string, customRadius: string) {
  const raw = value === "custom" ? customRadius : value;
  const radius = Number(raw);
  return Number.isFinite(radius) && radius > 0 ? radius : undefined;
}

export function LocationRequest({
  forceOpen = false,
  onClose,
}: {
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const stream = useStreamContext();
  const slots = stream.values.slots;
  const userLocation = stream.values.user_location;
  const hasStoredUserLocation =
    typeof userLocation?.latitude === "number" &&
    typeof userLocation?.longitude === "number";
  const hasStoredSlotLocation =
    typeof slots?.location === "object" &&
    typeof slots.location?.latitude === "number" &&
    typeof slots.location?.longitude === "number";
  const hasLegacySlotLocation =
    typeof slots?.latitude === "number" && typeof slots?.longitude === "number";
  const hasSubmittedTextLocation =
    typeof slots?.location === "string" &&
    slots.location.trim().length > 0 &&
    stream.values.location_confirmation_required !== true;
  const hasCompletedLocation =
    hasStoredUserLocation ||
    hasStoredSlotLocation ||
    hasLegacySlotLocation ||
    hasSubmittedTextLocation;
  const shouldRequestLocation =
    (stream.values.request_user_location === true && !hasCompletedLocation) ||
    forceOpen;
  const storedLocation =
    typeof slots?.location === "object" &&
    typeof slots.location?.latitude === "number" &&
    typeof slots.location?.longitude === "number"
      ? slots.location
      : hasStoredUserLocation
        ? userLocation
        : undefined;
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [selectedLocation, setSelectedLocation] =
    useState<SelectedLocation | null>(null);
  const [radiusOption, setRadiusOption] = useState("");
  const [customRadius, setCustomRadius] = useState("");
  const [manualLocation, setManualLocation] = useState("");
  const [isChangingLocation, setIsChangingLocation] = useState(false);
  const [hasSubmittedLocation, setHasSubmittedLocation] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<
    GoogleAutocompletePrediction[]
  >([]);
  const [autocompleteStatus, setAutocompleteStatus] =
    useState<AutocompleteStatus>("idle");
  const requestedForCurrentPrompt = useRef(false);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const placesServiceElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<GoogleMarker | null>(null);
  const circleRef = useRef<GoogleCircle | null>(null);
  const autocompleteServiceRef = useRef<GoogleAutocompleteService | null>(null);
  const placesServiceRef = useRef<GooglePlacesService | null>(null);
  const autocompleteSessionTokenRef =
    useRef<GoogleAutocompleteSessionToken | null>(null);

  const radiusMiles = parseRadius(radiusOption, customRadius);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError(
        "This browser does not support location permission. Search for a city, address, hospital, or postal code instead.",
      );
      setStatus("manual");
      setIsChangingLocation(true);
      return;
    }

    setLocationError(null);
    setIsChangingLocation(false);
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const browserLocation: SelectedLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          label: "Current browser location",
          provider: "browser_geolocation",
        };
        setSelectedLocation({
          ...browserLocation,
          label: "Resolving current location…",
        });
        setStatus("ready");

        loadGoogleMaps()
          .then((google) => {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode(
              {
                location: {
                  lat: browserLocation.latitude,
                  lng: browserLocation.longitude,
                },
              },
              (results, geocodeStatus) => {
                const label =
                  geocodeStatus === "OK"
                    ? results?.[0]?.formatted_address
                    : undefined;
                setSelectedLocation({
                  ...browserLocation,
                  label: label || "Current browser location",
                });
              },
            );
          })
          .catch(() => {
            setSelectedLocation(browserLocation);
          });
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Browser location permission was blocked. Search for a city, address, hospital, or postal code instead."
            : "I could not get your browser location. Search for a city, address, hospital, or postal code instead.";
        setLocationError(message);
        setStatus("manual");
        setIsChangingLocation(true);
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 300000,
      },
    );
  }, []);

  useEffect(() => {
    if (!shouldRequestLocation) {
      requestedForCurrentPrompt.current = false;
      setHasSubmittedLocation(false);
      setStatus("idle");
      setSelectedLocation(null);
      setIsChangingLocation(false);
      setLocationError(null);
      setPredictions([]);
      setAutocompleteStatus("idle");
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      autocompleteServiceRef.current = null;
      placesServiceRef.current = null;
      autocompleteSessionTokenRef.current = null;
      return;
    }
    if (hasSubmittedLocation) {
      return;
    }
    if (hasCompletedLocation && storedLocation && !selectedLocation) {
      setSelectedLocation({
        latitude: storedLocation.latitude,
        longitude: storedLocation.longitude,
        accuracy: storedLocation.accuracy,
        label: storedLocation.label || "Current search location",
        provider:
          storedLocation.provider === "google_places"
            ? "google_places"
            : "browser_geolocation",
        provider_place_id: storedLocation.provider_place_id,
      });
      setStatus("ready");
      return;
    }
    if (hasSubmittedTextLocation && !selectedLocation) {
      setManualLocation(
        typeof slots?.location === "string" ? slots.location : "",
      );
      setStatus("manual");
      setIsChangingLocation(true);
      return;
    }
    if (requestedForCurrentPrompt.current) return;

    requestedForCurrentPrompt.current = true;
    requestLocation();
  }, [
    hasCompletedLocation,
    hasSubmittedLocation,
    hasSubmittedTextLocation,
    requestLocation,
    selectedLocation,
    shouldRequestLocation,
    slots?.location,
    storedLocation,
  ]);

  useEffect(() => {
    if (!shouldRequestLocation || !selectedLocation || !mapElementRef.current) {
      return;
    }

    let active = true;
    loadGoogleMaps()
      .then((google) => {
        if (!active || !mapElementRef.current) return;

        const center = {
          lat: selectedLocation.latitude,
          lng: selectedLocation.longitude,
        };
        if (!mapRef.current) {
          mapRef.current = new google.maps.Map(mapElementRef.current, {
            center,
            zoom: radiusMiles ? 10 : 12,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
        } else {
          mapRef.current.setCenter(center);
          mapRef.current.setZoom(radiusMiles ? 10 : 12);
        }

        if (!markerRef.current) {
          markerRef.current = new google.maps.Marker({
            map: mapRef.current,
            position: center,
            title: selectedLocation.label,
          });
        } else {
          markerRef.current.setPosition(center);
          markerRef.current.setTitle(selectedLocation.label);
        }

        if (radiusMiles) {
          if (!circleRef.current) {
            circleRef.current = new google.maps.Circle({
              map: mapRef.current,
              center,
              radius: milesToMeters(radiusMiles),
              fillColor: "#2563eb",
              fillOpacity: 0.12,
              strokeColor: "#2563eb",
              strokeOpacity: 0.8,
              strokeWeight: 2,
            });
          } else {
            circleRef.current.setMap(mapRef.current);
            circleRef.current.setCenter(center);
            circleRef.current.setRadius(milesToMeters(radiusMiles));
          }
        } else if (circleRef.current) {
          circleRef.current.setMap(null);
        }

        setMapsError(null);
      })
      .catch((error: Error) => setMapsError(error.message));

    return () => {
      active = false;
    };
  }, [radiusMiles, selectedLocation, shouldRequestLocation]);

  useEffect(() => {
    if (!shouldRequestLocation || !isChangingLocation) {
      return;
    }

    let active = true;
    setAutocompleteStatus("loading");
    loadGoogleMaps()
      .then((google) => {
        if (!active) return;
        autocompleteServiceRef.current =
          autocompleteServiceRef.current ??
          new google.maps.places.AutocompleteService();
        if (placesServiceElementRef.current) {
          placesServiceRef.current =
            placesServiceRef.current ??
            new google.maps.places.PlacesService(
              placesServiceElementRef.current,
            );
        }
        autocompleteSessionTokenRef.current =
          autocompleteSessionTokenRef.current ??
          new google.maps.places.AutocompleteSessionToken();
        setMapsError(null);
        setAutocompleteStatus("ready");
      })
      .catch((error: Error) => {
        setMapsError(error.message);
        setStatus("manual");
        setAutocompleteStatus("error");
      });

    return () => {
      active = false;
    };
  }, [isChangingLocation, shouldRequestLocation]);

  useEffect(() => {
    const input = manualLocation.trim();
    if (
      !shouldRequestLocation ||
      !isChangingLocation ||
      autocompleteStatus !== "ready" ||
      !autocompleteServiceRef.current ||
      !autocompleteSessionTokenRef.current ||
      input.length < 2
    ) {
      setPredictions([]);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      autocompleteServiceRef.current?.getPlacePredictions(
        {
          input,
          sessionToken: autocompleteSessionTokenRef.current!,
        },
        (nextPredictions, predictionStatus) => {
          if (!active) return;
          if (predictionStatus === "OK" && nextPredictions?.length) {
            setPredictions(nextPredictions);
            return;
          }
          setPredictions([]);
        },
      );
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    autocompleteStatus,
    isChangingLocation,
    manualLocation,
    shouldRequestLocation,
  ]);

  const startChangeLocationFlow = () => {
    setIsChangingLocation(true);
    setStatus((current) => (current === "idle" ? "manual" : current));
    setManualLocation("");
    setPredictions([]);
    autocompleteSessionTokenRef.current = null;
  };

  const selectPrediction = (prediction: GoogleAutocompletePrediction) => {
    if (
      !placesServiceRef.current ||
      !autocompleteSessionTokenRef.current ||
      stream.isLoading
    ) {
      return;
    }

    setAutocompleteStatus("loading");
    placesServiceRef.current.getDetails(
      {
        placeId: prediction.place_id,
        fields: ["formatted_address", "geometry", "name", "place_id"],
        sessionToken: autocompleteSessionTokenRef.current,
      },
      (place, placeStatus) => {
        const geometry = place?.geometry?.location;
        if (placeStatus !== "OK" || !geometry) {
          setAutocompleteStatus("error");
          setMapsError("Google Places could not resolve that selection.");
          return;
        }
        setSelectedLocation({
          latitude: geometry.lat(),
          longitude: geometry.lng(),
          label:
            place.formatted_address ||
            place.name ||
            prediction.description ||
            "Selected location",
          provider: "google_places",
          provider_place_id: place.place_id || prediction.place_id,
        });
        setStatus("ready");
        setIsChangingLocation(false);
        setManualLocation("");
        setPredictions([]);
        setAutocompleteStatus("ready");
        autocompleteSessionTokenRef.current = null;
      },
    );
  };

  const submitSelectedLocation = () => {
    if (!selectedLocation || stream.isLoading) return;
    setHasSubmittedLocation(true);
    onClose?.();

    const nextSlots: TrialSlots = {
      ...(stream.values.slots ?? {}),
      location: {
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        accuracy: selectedLocation.accuracy,
        label: selectedLocation.label,
        provider: selectedLocation.provider,
        provider_place_id: selectedLocation.provider_place_id,
      },
      location_confirmed: true,
    };
    delete nextSlots.latitude;
    delete nextSlots.longitude;
    if (radiusMiles) {
      nextSlots.radius_miles = radiusMiles;
    } else {
      delete nextSlots.radius_miles;
    }

    const userLocation = {
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
      accuracy: selectedLocation.accuracy,
      label: selectedLocation.label,
      provider: selectedLocation.provider,
      provider_place_id: selectedLocation.provider_place_id,
    };

    stream.submit(
      {
        slots: nextSlots,
      },
      {
        streamMode: ["values"],
        streamSubgraphs: true,
        streamResumable: true,
        optimisticValues: (previous) => ({
          ...previous,
          request_user_location: false,
          slots: nextSlots,
        }),
      },
    );
  };

  const submitManualLocation = (event: FormEvent) => {
    event.preventDefault();
    const location = manualLocation.trim();
    if (!location || stream.isLoading) return;
    setHasSubmittedLocation(true);
    onClose?.();

    const nextSlots: TrialSlots = {
      ...(stream.values.slots ?? {}),
      location,
    };
    if (radiusMiles) {
      nextSlots.radius_miles = radiusMiles;
    } else {
      delete nextSlots.radius_miles;
    }

    stream.submit(
      { slots: nextSlots },
      {
        streamMode: ["values"],
        streamSubgraphs: true,
        streamResumable: true,
        optimisticValues: (previous) => ({
          ...previous,
          request_user_location: false,
          slots: nextSlots,
        }),
      },
    );
    setManualLocation("");
  };

  if (!shouldRequestLocation || hasSubmittedLocation) return null;

  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-white p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 rounded-full p-2">
          <MapPin className="text-primary size-5" />
        </div>
        <div className="flex-1">
          <p className="font-medium">Choose your study search location</p>
          <p className="text-muted-foreground mt-1 text-sm">
            I’ll use this to show studies closest to you that may be practical
            to participate in. You can add a radius if you only want nearby
            options.
          </p>
        </div>
      </div>

      {status === "requesting" && (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Asking your browser for location permission…
        </div>
      )}

      {locationError && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {locationError}
        </div>
      )}

      {selectedLocation && (
        <div className="mt-4 space-y-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Location</span>
            <Input
              value={selectedLocation.label}
              readOnly
              aria-label="Selected location"
            />
          </label>
          <div
            ref={mapElementRef}
            className="h-56 w-full overflow-hidden rounded-xl border bg-slate-100"
            aria-label="Selected search location map"
          />
          {mapsError && (
            <p className="text-sm text-amber-700">
              Map preview is unavailable: {mapsError}
            </p>
          )}
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-sm font-medium">{selectedLocation.label}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {selectedLocation.latitude.toFixed(5)},{" "}
              {selectedLocation.longitude.toFixed(5)}
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Radius optional</span>
          <select
            value={radiusOption}
            onChange={(event) => setRadiusOption(event.target.value)}
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
          >
            {RADIUS_OPTIONS.map((option) => (
              <option
                key={option.value || "any"}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {radiusOption === "custom" && (
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Miles</span>
            <Input
              type="number"
              min="1"
              max="5000"
              value={customRadius}
              onChange={(event) => setCustomRadius(event.target.value)}
              placeholder="35"
              className="sm:w-28"
            />
          </label>
        )}
      </div>

      {isChangingLocation && GOOGLE_MAPS_BROWSER_KEY && (
        <div className="mt-4">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Change location</span>
            <Input
              value={manualLocation}
              onChange={(event) => setManualLocation(event.target.value)}
              placeholder="Search city, address, hospital, or postal code"
              autoFocus
            />
          </label>
          {autocompleteStatus === "loading" && (
            <p className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
              <LoaderCircle className="size-3 animate-spin" />
              Loading Google Places autocomplete…
            </p>
          )}
          {autocompleteStatus === "ready" && (
            <p className="text-muted-foreground mt-2 text-xs">
              Start typing, then pick a result from the Google suggestions.
            </p>
          )}
          {predictions.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-xl border bg-white shadow-xs">
              {predictions.map((prediction) => (
                <button
                  key={prediction.place_id}
                  type="button"
                  onClick={() => selectPrediction(prediction)}
                  className="hover:bg-muted focus:bg-muted block w-full border-b px-3 py-2 text-left text-sm last:border-b-0"
                >
                  <span className="block font-medium">
                    {prediction.structured_formatting?.main_text ||
                      prediction.description}
                  </span>
                  {prediction.structured_formatting?.secondary_text && (
                    <span className="text-muted-foreground block text-xs">
                      {prediction.structured_formatting.secondary_text}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        ref={placesServiceElementRef}
        className="hidden"
        aria-hidden="true"
      />

      {(status === "manual" &&
        (!GOOGLE_MAPS_BROWSER_KEY || autocompleteStatus === "error")) ||
      (isChangingLocation && !GOOGLE_MAPS_BROWSER_KEY) ? (
        <form
          onSubmit={submitManualLocation}
          className="mt-4 flex flex-col gap-2 sm:flex-row"
        >
          <Input
            value={manualLocation}
            onChange={(event) => setManualLocation(event.target.value)}
            placeholder="Vancouver, BC or V6B 1A1"
            aria-label="Manual location"
            autoFocus
          />
          <Button
            type="submit"
            disabled={!manualLocation.trim() || stream.isLoading}
          >
            Use location
          </Button>
        </form>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {selectedLocation && (
          <Button
            type="button"
            onClick={submitSelectedLocation}
            disabled={stream.isLoading}
          >
            <Check />
            Use this location
          </Button>
        )}
        <Button
          type="button"
          variant={selectedLocation ? "outline" : "default"}
          onClick={() => {
            if (GOOGLE_MAPS_BROWSER_KEY) {
              startChangeLocationFlow();
              return;
            }
            setStatus("manual");
            setIsChangingLocation(true);
          }}
          disabled={stream.isLoading}
          className={cn(
            !selectedLocation && status !== "manual" && "sm:w-auto",
          )}
        >
          <Pencil />
          Change location
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={requestLocation}
          disabled={status === "requesting" || stream.isLoading}
        >
          {status === "requesting" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <LocateFixed />
          )}
          Use browser location
        </Button>
      </div>
    </div>
  );
}
