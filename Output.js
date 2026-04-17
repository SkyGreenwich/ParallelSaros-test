// Output hook - thin wrapper

const modifier = (text) => {
  text = onOutputPs(text);
  return { text };
};

modifier(text);
