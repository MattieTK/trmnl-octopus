export const homepage = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TRMNL Octopus Agile</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
    code { background: #f2f2f2; padding: 0.1rem 0.3rem; border-radius: 3px; }
    footer { margin-top: 3rem; font-size: 0.9rem; color: #666; }
  </style>
</head>
<body>
  <h1>TRMNL Octopus Agile</h1>
  <p>A TRMNL e-ink plugin showing the Octopus Agile electricity price ahead: the rest of today in the morning, and today plus tomorrow once next-day prices are published around 16:00. It draws a price chart against the Flexible Octopus variable tariff and picks the cheapest windows for a washing machine and a dishwasher.</p>
  <h2>Install</h2>
  <p>Search for "Agile Octopus prices" in the TRMNL recipes directory, choose your electricity region and, optionally, your appliance run times.</p>
  <h2>API</h2>
  <p>The plugin polls <code>/trmnl?region=C&amp;durations=2,3</code>. <code>region</code> is your DNO letter (A to P, no I or O). <code>durations</code> lists appliance run lengths in hours. Responses are cached until the next half hour.</p>
  <p>Source code is on <a href="https://github.com/MattieTK/trmnl-octopus">GitHub</a>.</p>
  <footer>Data: Octopus Energy public API. Not an Octopus Energy product.</footer>
</body>
</html>`;
