// Immutable application transitions; a diameter gesture becomes one command.
#[derive(Clone, Copy)]
pub struct Circle {
    pub x: f64,
    pub y: f64,
    pub diameter: f64,
}

#[derive(Clone, Copy)]
pub struct Action {
    pub kind: i64,
    pub index: usize,
    pub circle: Circle,
    pub before: f64,
    pub after: f64,
}

#[derive(Clone)]
pub struct Drawing {
    pub circles: Vec<Circle>,
    pub history: Vec<Action>,
    pub cursor: usize,
}

pub fn initial() -> Drawing {
    Drawing {
        circles: Vec::new(),
        history: Vec::new(),
        cursor: 0,
    }
}

pub fn nearest(circles: &Vec<Circle>, x: f64, y: f64) -> i64 {
    let mut found = -1_i64;
    let mut distance = 1000000000.0;
    for i in 0_usize..circles.len() {
        let circle = circles[i];
        let dx = circle.x - x;
        let dy = circle.y - y;
        let squared = dx * dx + dy * dy;
        if squared <= circle.diameter * circle.diameter / 4.0 && squared < distance {
            found = i as i64;
            distance = squared;
        }
    }
    found
}

fn record(mut drawing: Drawing, action: Action) -> Drawing {
    while drawing.history.len() > drawing.cursor {
        drawing.history.pop();
    }
    drawing.history.push(action);
    drawing.cursor += 1;
    drawing
}

pub fn create(mut drawing: Drawing, x: f64, y: f64) -> Drawing {
    if drawing.circles.len() >= 1000
        || !x.is_finite()
        || !y.is_finite()
        || x < 0.0
        || y < 0.0
        || x > 600.0
        || y > 340.0
    {
        return drawing;
    }
    let circle = Circle {
        x,
        y,
        diameter: 30.0,
    };
    let index = drawing.circles.len();
    drawing.circles.push(circle);
    record(
        drawing,
        Action {
            kind: 0,
            index,
            circle,
            before: 0.0,
            after: 30.0,
        },
    )
}

pub fn preview(mut drawing: Drawing, index: i64, diameter: f64) -> Drawing {
    if index >= 0
        && (index as usize) < drawing.circles.len()
        && diameter.is_finite()
        && diameter >= 1.0
        && diameter <= 200.0
    {
        drawing.circles[index as usize].diameter = diameter;
    }
    drawing
}

pub fn finish(drawing: Drawing, index: i64, original: f64) -> Drawing {
    if index < 0 || (index as usize) >= drawing.circles.len() {
        return drawing;
    }
    let circle = drawing.circles[index as usize];
    if circle.diameter == original {
        return drawing;
    }
    record(
        drawing,
        Action {
            kind: 1,
            index: index as usize,
            circle,
            before: original,
            after: circle.diameter,
        },
    )
}

pub fn undo(mut drawing: Drawing) -> Drawing {
    if drawing.cursor == 0 {
        return drawing;
    }
    drawing.cursor -= 1;
    let action = drawing.history[drawing.cursor];
    if action.kind == 0 {
        drawing.circles.pop();
    } else {
        drawing.circles[action.index].diameter = action.before;
    }
    drawing
}

pub fn redo(mut drawing: Drawing) -> Drawing {
    if drawing.cursor >= drawing.history.len() {
        return drawing;
    }
    let action = drawing.history[drawing.cursor];
    drawing.cursor += 1;
    if action.kind == 0 {
        drawing.circles.push(action.circle);
    } else {
        drawing.circles[action.index].diameter = action.after;
    }
    drawing
}
