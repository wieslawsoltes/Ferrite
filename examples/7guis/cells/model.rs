// A bounded expression parser, RPN evaluator and reverse dependency graph.
// The UI contains no formula semantics. Only the affected dependency closure is evaluated.
#[derive(Clone, Copy)]
pub struct Token { pub kind: i64, pub number: f64, pub a: usize, pub b: usize }
#[derive(Clone)]
pub struct Cell { pub source: String, pub display: String, pub number: f64, pub numeric: bool, pub error: i64, pub parse_error: i64, pub kind: i64, pub code: Vec<Token>, pub deps: Vec<usize> }
#[derive(Clone)]
pub struct Sheet { pub cells: Vec<Cell>, pub users: Vec<Vec<usize>>, pub evaluations: usize, pub total: usize, pub revision: usize }
struct Parser { bytes: Vec<u8>, pos: usize, code: Vec<Token>, deps: Vec<usize>, seen: [bool; 2600], error: i64, depth: usize }
#[derive(Clone, Copy)]
struct Value { number: f64, sum: f64, product: f64, minimum: f64, maximum: f64, count: usize, error: i64 }
pub fn label(index: usize) -> String { let mut s = String::new(); s.push((65_usize + index % 26) as u8 as char); s.push_str((index / 26).to_string().as_str()); s }
pub fn empty() -> Cell { Cell { source: String::new(), display: String::new(), number: 0.0, numeric: true, error: 0, parse_error: 0, kind: 0, code: Vec::new(), deps: Vec::new() } }
pub fn initial() -> Sheet {
    let mut cells: Vec<Cell> = Vec::new(); let mut users: Vec<Vec<usize>> = Vec::new();
    for _i in 0..2600 { cells.push(empty()); users.push(Vec::new()); }
    Sheet { cells, users, evaluations: 0, total: 0, revision: 0 }
}
pub fn error_text(code: i64) -> String {
    String::from(match code { 1 => "#VALUE!", 2 => "#DIV/0!", 3 => "#REF!", 4 => "#CYCLE!", 5 => "#NUM!", 6 => "#NAME?", _ => "#ERROR!" })
}
fn peek(p: &Parser) -> u8 { if p.pos < p.bytes.len() { p.bytes[p.pos] } else { 0 } }
fn whitespace(p: &mut Parser) { while p.pos < p.bytes.len() && (p.bytes[p.pos] == 32 || p.bytes[p.pos] == 9 || p.bytes[p.pos] == 10 || p.bytes[p.pos] == 13) { p.pos += 1; } }
fn digit(byte: u8) -> bool { byte >= 48 && byte <= 57 }
fn letter(byte: u8) -> bool { byte >= 65 && byte <= 90 }
fn dependency(p: &mut Parser, index: usize) {
    if !p.seen[index] { p.seen[index] = true; p.deps.push(index); }
}
fn emit(p: &mut Parser, kind: i64, number: f64, a: usize, b: usize) {
    if p.code.len() >= 1024 { p.error = 7; } else { p.code.push(Token { kind, number, a, b }); }
}
fn address(p: &mut Parser) -> usize {
    whitespace(&mut *p); let col = peek(&*p);
    if !letter(col) { p.error = 3; return 0; }
    p.pos += 1;
    if !digit(peek(&*p)) { p.error = 3; return 0; }
    let mut row = 0_usize;
    while digit(peek(&*p)) { row = row * 10 + (peek(&*p) - 48) as usize; p.pos += 1; if row > 99 { p.error = 3; return 0; } }
    row * 26 + (col - 65) as usize
}
fn function(name: &str) -> usize {
    match name { "ADD" => 1, "SUB" => 2, "MUL" => 3, "DIV" => 4, "MOD" => 5, "SUM" => 6, "PROD" => 7, "AVG" => 8, "COUNT" => 9, "MIN" => 10, "MAX" => 11, _ => 0 }
}
fn expression(p: &mut Parser) {
    term(&mut *p);
    loop {
        whitespace(&mut *p); let op = peek(&*p);
        if p.error != 0 || (op != 43 && op != 45) { break; }
        p.pos += 1; term(&mut *p); emit(&mut *p, 3, 0.0, if op == 43 { 1 } else { 2 }, 2);
    }
}
fn term(p: &mut Parser) {
    primary(&mut *p);
    loop {
        whitespace(&mut *p); let op = peek(&*p);
        if p.error != 0 || (op != 42 && op != 47) { break; }
        p.pos += 1; primary(&mut *p); emit(&mut *p, 3, 0.0, if op == 42 { 3 } else { 4 }, 2);
    }
}
fn primary(p: &mut Parser) {
    if p.error != 0 { return; }
    p.depth += 1; if p.depth > 48 { p.error = 7; return; }
    whitespace(&mut *p); let byte = peek(&*p);
    if byte == 43 || byte == 45 {
        p.pos += 1; primary(&mut *p); if byte == 45 { emit(&mut *p, 3, 0.0, 12, 1); }
    } else if byte == 40 {
        p.pos += 1; expression(&mut *p); whitespace(&mut *p);
        if peek(&*p) == 41 { p.pos += 1; } else { p.error = 7; }
    } else if digit(byte) || byte == 46 {
        let mut text = String::new(); let mut exponent = false;
        while p.pos < p.bytes.len() {
            let current = peek(&*p);
            if digit(current) || current == 46 { text.push(current as char); p.pos += 1; }
            else if current == 69 && !exponent { exponent = true; text.push('E'); p.pos += 1; let sign = peek(&*p); if sign == 43 || sign == 45 { text.push(sign as char); p.pos += 1; } }
            else { break; }
        }
        match text.parse::<f64>() { Ok(value) => { if value.is_finite() { emit(&mut *p, 0, value, 0, 0); } else { p.error = 5; } }, Err(_e) => { p.error = 7; } }
    } else if letter(byte) {
        let start = p.pos; let mut name = String::new();
        while letter(peek(&*p)) { name.push(peek(&*p) as char); p.pos += 1; }
        if name.len() > 1 && digit(peek(&*p)) { p.error = 3; } else if name.len() == 1 && digit(peek(&*p)) {
            p.pos = start; let first = address(&mut *p); whitespace(&mut *p);
            if peek(&*p) == 58 {
                p.pos += 1; let last = address(&mut *p);
                if first % 26 > last % 26 || first / 26 > last / 26 { p.error = 3; }
                if p.error == 0 {
                    for row in first / 26..last / 26 + 1 { for col in first % 26..last % 26 + 1 { dependency(&mut *p, row * 26 + col); } }
                    emit(&mut *p, 2, 0.0, first, last);
                }
            } else { dependency(&mut *p, first); emit(&mut *p, 1, 0.0, first, first); }
        } else {
            let op = function(name.as_str()); whitespace(&mut *p);
            if op == 0 { p.error = 6; } else if peek(&*p) != 40 { p.error = 7; } else {
                p.pos += 1; whitespace(&mut *p); let mut args = 0_usize;
                if peek(&*p) != 41 {
                    loop { expression(&mut *p); args += 1; whitespace(&mut *p); if p.error != 0 || peek(&*p) != 44 { break; } p.pos += 1; }
                }
                if peek(&*p) == 41 { p.pos += 1; } else { p.error = 7; }
                if op <= 5 && args != 2 { p.error = 7; }
                emit(&mut *p, 3, 0.0, op, args);
            }
        }
    } else { p.error = 7; }
    p.depth -= 1;
}
pub fn parse(source: String) -> Cell {
    let mut cell = empty(); cell.source = source.clone();
    if source.len() > 4096 { cell.error = 7; cell.parse_error = 7; cell.display = error_text(7); return cell; }
    let text = source.trim().to_string();
    if !text.starts_with("=") {
        if text.is_empty() { return cell; }
        match text.parse::<f64>() {
            Ok(number) => { if number.is_finite() { cell.number = number; cell.display = number.to_string(); } else { cell.error = 5; cell.parse_error = 5; cell.display = error_text(5); } },
            Err(_e) => { cell.kind = 1; cell.numeric = false; cell.display = source; }
        }
        return cell;
    }
    let mut parser = Parser { seen: [false; 2600], bytes: text.to_ascii_uppercase().into_bytes(), pos: 1, code: Vec::new(), deps: Vec::new(), error: 0, depth: 0 };
    expression(&mut parser); whitespace(&mut parser);
    if parser.pos != parser.bytes.len() && parser.error == 0 { parser.error = 7; }
    cell.kind = 2; cell.error = parser.error; cell.parse_error = parser.error;
    cell.code = parser.code.clone(); cell.deps = parser.deps.clone();
    if cell.error != 0 { cell.display = error_text(cell.error); cell.code = Vec::new(); cell.deps = Vec::new(); }
    cell
}
fn scalar(number: f64, error: i64) -> Value { Value { number, sum: number, product: number, minimum: number, maximum: number, count: 1, error } }
fn empty_value() -> Value { Value { number: 0.0, sum: 0.0, product: 1.0, minimum: 0.0, maximum: 0.0, count: 0, error: 0 } }
fn aggregate(mut a: Value, b: Value) -> Value {
    if a.error == 0 { a.error = b.error; }
    if b.count > 0 { if a.count == 0 || b.minimum < a.minimum { a.minimum = b.minimum; } if a.count == 0 || b.maximum > a.maximum { a.maximum = b.maximum; } }
    if a.count == 0 && b.count > 0 { a.number = b.number; }
    a.sum += b.sum; a.product *= b.product; a.count += b.count; a
}
fn cell_value(sheet: &Sheet, index: usize) -> Value {
    let cell = &sheet.cells[index];
    scalar(cell.number, if cell.error != 0 { cell.error } else if !cell.numeric { 1 } else { 0 })
}
fn execute(sheet: &Sheet, code: &Vec<Token>) -> Value {
    let mut stack: Vec<Value> = Vec::new();
    for i in 0_usize..code.len() {
        let token = code[i];
        if token.kind == 0 { stack.push(scalar(token.number, 0)); }
        else if token.kind == 1 { stack.push(cell_value(sheet, token.a)); }
        else if token.kind == 2 {
            let mut value = empty_value();
            for row in token.a / 26..token.b / 26 + 1 { for col in token.a % 26..token.b % 26 + 1 { value = aggregate(value, cell_value(sheet, row * 26 + col)); } }
            stack.push(value);
        } else {
            if stack.len() < token.b { return scalar(0.0, 7); }
            if token.a <= 5 {
                let right = stack.pop().unwrap(); let left = stack.pop().unwrap();
                let error: i64 = if left.error != 0 { left.error } else { right.error };
                if error != 0 { stack.push(scalar(0.0, error)); }
                else if left.count != 1 || right.count != 1 { stack.push(scalar(0.0, 1)); }
                else if (token.a == 4 || token.a == 5) && right.number == 0.0 { stack.push(scalar(0.0, 2)); }
                else { let n = match token.a { 1 => left.number + right.number, 2 => left.number - right.number, 3 => left.number * right.number, 4 => left.number / right.number, _ => left.number % right.number }; stack.push(scalar(n, if n.is_finite() { 0 } else { 5 })); }
            } else if token.a == 12 { let value = stack.pop().unwrap(); stack.push(scalar(-value.number, if value.count != 1 { 1 } else { value.error })); }
            else {
                let mut combined = empty_value(); for _j in 0_usize..token.b { combined = aggregate(combined, stack.pop().unwrap()); }
                let n = match token.a { 6 => combined.sum, 7 => combined.product, 8 => if combined.count == 0 { 0.0 } else { combined.sum / combined.count as f64 }, 9 => combined.count as f64, 10 => combined.minimum, _ => combined.maximum };
                let error: i64 = if combined.error != 0 { combined.error } else if combined.count == 0 && (token.a == 8 || token.a == 10 || token.a == 11) { 1 } else if !n.is_finite() { 5 } else { 0 };
                stack.push(scalar(n, error));
            }
        }
    }
    if stack.len() != 1 { return scalar(0.0, 7); }
    let result = stack[0]; if result.count != 1 { scalar(0.0, 1) } else { result }
}
fn evaluate(sheet: &mut Sheet, index: usize) {
    sheet.evaluations += 1; sheet.total += 1;
    if sheet.cells[index].kind != 2 || sheet.cells[index].parse_error != 0 { return; }
    let code = sheet.cells[index].code.clone(); let result = execute(&*sheet, &code);
    sheet.cells[index].number = result.number; sheet.cells[index].numeric = true; sheet.cells[index].error = result.error;
    sheet.cells[index].display = if result.error == 0 { result.number.to_string() } else { error_text(result.error) };
}
pub fn set(mut sheet: Sheet, index: usize, source: String) -> Sheet {
    if index >= 2600 { return sheet; }
    if sheet.cells[index].source == source { sheet.evaluations = 0; return sheet; }
    // Remove only this formula's previous reverse edges.
    let old = sheet.cells[index].deps.clone();
    for d in old { let mut at = 0_usize; while at < sheet.users[d].len() { if sheet.users[d][at] == index { sheet.users[d].remove(at); } else { at += 1; } } }
    let cell = parse(source); let deps = cell.deps.clone(); sheet.cells[index] = cell;
    for d in deps { sheet.users[d].push(index); }
    let mut dirty = [false; 2600]; let mut queue: Vec<usize> = Vec::new(); dirty[index] = true; queue.push(index); let mut cursor = 0_usize;
    while cursor < queue.len() { let current = queue[cursor]; cursor += 1; for d in sheet.users[current].clone() { if !dirty[d] { dirty[d] = true; queue.push(d); } } }
    let mut pending = [0_usize; 2600]; let mut ready: Vec<usize> = Vec::new();
    for i in queue.clone() { for d in sheet.cells[i].deps.clone() { if dirty[d] { pending[i] += 1; } } if pending[i] == 0 { ready.push(i); } }
    cursor = 0; sheet.evaluations = 0;
    while cursor < ready.len() {
        let current = ready[cursor]; cursor += 1; evaluate(&mut sheet, current); dirty[current] = false;
        for d in sheet.users[current].clone() { if dirty[d] { pending[d] -= 1; if pending[d] == 0 { ready.push(d); } } }
    }
    // Kahn's remaining nodes are cycles or depend on cycles. Recovery is automatic
    // when an edge is removed by a later edit; no recursive evaluation stack exists.
    for i in queue { if dirty[i] { sheet.cells[i].error = 4; sheet.cells[i].display = error_text(4); sheet.evaluations += 1; sheet.total += 1; } }
    sheet.revision += 1; sheet
}
