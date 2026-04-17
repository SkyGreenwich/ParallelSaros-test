// Context hook - thin wrapper

const modifier = (text) => {
  text = onContextPs(text);
  return { text };
};

modifier(text);
