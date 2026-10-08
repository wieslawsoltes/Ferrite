export class Lexer {
 static tokenize(source) {
  const tokens=[], rx=/\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'|(?:\d+\.\d+|\d+)(?:u32|i32|usize|f64)?|[A-Za-z_][A-Za-z_0-9]*|->|=>|==|!=|<=|>=|&&|\|\||\+=|-=|\*=|\/=|::|[{}()[\],;:.!<>+=*\/%&|\-]/gy;
  let offset=0,line=1,column=1;
  while(offset<source.length) {
    rx.lastIndex=offset;const m=rx.exec(source);
    if(!m)throw new Error("Unexpected character '"+source[offset]+"' at "+line+":"+column);
    const value=m[0],start={offset,line,column};
    for(const c of value){if(c==="\n"){line++;column=1;}else column++;}
    offset=rx.lastIndex;
    if(/^\s|^\/\//.test(value)||value.startsWith("/*"))continue;
    tokens.push({value,...start});
  }
  tokens.push({value:"EOF",offset,line,column});return tokens;
}

}
