#[derive(Clone)]
pub struct Person {
    pub id: u32,
    pub name: String,
    pub surname: String,
}

#[derive(Clone)]
pub struct People {
    pub rows: Vec<Person>,
    pub next_id: u32,
}

pub fn initial() -> People {
    People {
        rows: vec![
            Person {
                id: 0,
                name: String::from("Hans"),
                surname: String::from("Emil"),
            },
            Person {
                id: 1,
                name: String::from("Max"),
                surname: String::from("Mustermann"),
            },
            Person {
                id: 2,
                name: String::from("Roman"),
                surname: String::from("Tisch"),
            },
        ],
        next_id: 3,
    }
}

pub fn index(rows: &Vec<Person>, id: i64) -> Option<usize> {
    for i in 0_usize..rows.len() {
        if rows[i].id as i64 == id {
            return Some(i);
        }
    }
    None
}

pub fn create(mut people: People, name: String, surname: String) -> People {
    if people.rows.len() >= 10000 {
        return people;
    }
    people.rows.push(Person {
        id: people.next_id,
        name,
        surname,
    });
    people.next_id = people.next_id + 1;
    people
}

pub fn update(mut people: People, id: i64, name: String, surname: String) -> People {
    if let Some(i) = index(&people.rows, id) {
        people.rows[i].name = name;
        people.rows[i].surname = surname;
    }
    people
}

pub fn delete(mut people: People, id: i64) -> People {
    if let Some(i) = index(&people.rows, id) {
        people.rows.remove(i);
    }
    people
}
