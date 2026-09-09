/** One half-hour row as returned by the Octopus unit-rates endpoint. */
export type Rate = {
  value_exc_vat: number;
  value_inc_vat: number;
  valid_from: string;
  valid_to: string;
  payment_method: string | null;
};

/** How a price compares with the reference tariff. */
export type Band = "negative" | "below" | "above";

export type PricePoint = {
  time: string;
  end: string;
  price: number;
  vs_reference_pct: number;
  band: Band;
};

export type Slot = {
  time: string;
  price: number;
  band: Band;
  /** Top of the bar as a percentage of chart height. */
  y: number;
  /** Bar height as a percentage of chart height. */
  h: number;
};

export type Tick = { index: number; label: string };

export type CheapestWindow =
  | { hours: number; available: false }
  | {
      hours: number;
      available: true;
      day: string;
      start: string;
      end: string;
      average: number;
      vs_reference_pct: number;
      start_index: number;
      slot_count: number;
    };

export type Extreme = { time: string; day: string; price: number };

export type Payload = {
  ok: true;
  stale: boolean;
  region: { code: string; name: string };
  reference: { price: number; label: string; short: string };
  now: PricePoint;
  next: (PricePoint & { delta: number }) | null;
  window: {
    until: string;
    includes_tomorrow: boolean;
    tomorrow_pending: boolean;
    slot_count: number;
  };
  stats: {
    min: Extreme;
    max: Extreme;
    average: number;
    below_reference_pct: number;
    negative_count: number;
  };
  chart: {
    axis_max: number;
    axis_min: number;
    reference_y: number;
    zero_y: number;
    ticks: Tick[];
    tomorrow_index: number | null;
    tomorrow_label: string | null;
  };
  slots: Slot[];
  windows: CheapestWindow[];
  slot_label: string;
};

export type ErrorPayload = { ok: false; error: string };
