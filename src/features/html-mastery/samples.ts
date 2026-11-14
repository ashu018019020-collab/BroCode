/**
 * Starter and example documents for the HTML playground.
 *
 * They are DATA, not the page's own markup: the course page owns the single h1 of the rendered page,
 * so the sample documents live in this module instead of inside the component that ships them into
 * the sandboxed iframe.
 */
export const STARTER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My First HTML Page</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 16px; }
    h1 { color: #e34f26; margin: 0 0 8px; }
  </style>
</head>
<body>
  <h1>Hello BroCode!</h1>
  <p>My HTML learning journey starts here.</p>
  <button type="button" onclick="this.textContent = 'It works!'">Click me</button>
</body>
</html>
`;

export const EXAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Semantic page</title>
</head>
<body>
  <header>
    <h1>BroCode</h1>
    <nav><a href="#lessons">Lessons</a></nav>
  </header>
  <main>
    <article id="lessons">
      <h2>Semantic HTML</h2>
      <p>The structure describes the content, not the styling.</p>
      <figure>
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'%3E%3Crect width='160' height='90' fill='%23e34f26'/%3E%3Ctext x='80' y='52' font-family='Arial' font-size='18' fill='white' text-anchor='middle'%3EHTML%3C/text%3E%3C/svg%3E" alt="HTML badge">
        <figcaption>A real image element with alt text.</figcaption>
      </figure>
    </article>
  </main>
  <footer><p>Built while learning HTML.</p></footer>
</body>
</html>
`;
