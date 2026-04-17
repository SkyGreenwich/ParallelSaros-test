// Input hook - thin wrapper

const modifier = (text) => {
  text = onInputPs(text);
  return { text };
};

modifier(text);
