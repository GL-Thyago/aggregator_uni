<?php
if ($_SERVER['REQUEST_METHOD'] != "POST") die("a");

$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();
if (!$user) die("User not found");



$freeMode = rand(1, 10) == 1;
$freeSpin = rand(1, 20) == 1;
$freeNum = rand(1, 8) == 1;
$freeNum = false;

define("SLOTINCONS", 0);
define("ACTIVEICONS", 1);
define("ACTIVELINES", 2);
define("DROPLINEDATA", 3);
define("MULTIPLYCOUNT", 4);
define("PAYOUT", 5);
define("FREESPIN", 6);
define("FEATURESYMBOL", 7);
// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout,
$loseResults = [
    [
        ["Symbol_5", "Symbol_3", "Symbol_6", "Symbol_2", "Symbol_2", "Symbol_1", "Symbol_1", "Symbol_5", "Symbol_3"], [], [], [], 1, 0
    ],

    [
        ["Symbol_5", "Symbol_4", "Symbol_3", "Symbol_3", "Symbol_5", "Symbol_2", "Symbol_2", "Symbol_0", "Symbol_1"], [], [], [], 1, 0
    ],

    [
        ["Symbol_5", "Symbol_1", "Symbol_3", "Symbol_1", "Symbol_2", "Symbol_6", "Symbol_3", "Symbol_6", "Symbol_5"], [], [], [], 1, 0
    ],

    [
        ["Symbol_5", "Symbol_2", "Symbol_3", "Symbol_6", "Symbol_3", "Symbol_1", "Symbol_5", "Symbol_1", "Symbol_4"], [], [], [], 1, 0
    ],
    [
        ["Symbol_3", "Symbol_6", "Symbol_5", "Symbol_1", "Symbol_6", "Symbol_6", "Symbol_6", "Symbol_5", "Symbol_0"], [], [], [], 1, 0
    ],
    [
        ["Symbol_2", "Symbol_1", "Symbol_4", "Symbol_5", "Symbol_3", "Symbol_6", "Symbol_5", "Symbol_3", "Symbol_1"], [], [], [], 1, 0
    ],
    [
        ["Symbol_4", "Symbol_1", "Symbol_2", "Symbol_3", "Symbol_4", "Symbol_3", "Symbol_6", "Symbol_4", "Symbol_5"], [], [], [], 1, 0
    ],
    [
        ["Symbol_2", "Symbol_1", "Symbol_4", "Symbol_2", "Symbol_6", "Symbol_2", "Symbol_1", "Symbol_5", "Symbol_3"], [], [], [], 1, 0
    ],
    [
        ["Symbol_6", "Symbol_1", "Symbol_5", "Symbol_3", "Symbol_1", "Symbol_3", "Symbol_3", "Symbol_6", "Symbol_3"], [], [], [], 1, 0
    ],
    [
        ["Symbol_3", "Symbol_4", "Symbol_4", "Symbol_4", "Symbol_4", "Symbol_3", "Symbol_5", "Symbol_1", "Symbol_5"], [], [], [], 1, 0
    ],
    [
        ["Symbol_3", "Symbol_5", "Symbol_1", "Symbol_6", "Symbol_5", "Symbol_4", "Symbol_6", "Symbol_1", "Symbol_2"], [], [], [], 1, 0
    ],
    [
        ["Symbol_2", "Symbol_1", "Symbol_4", "Symbol_5", "Symbol_3", "Symbol_6", "Symbol_5", "Symbol_3", "Symbol_1"], [], [], [], 1, 0
    ],
    [
        ["Symbol_2", "Symbol_1", "Symbol_4", "Symbol_5", "Symbol_3", "Symbol_6", "Symbol_5", "Symbol_3", "Symbol_1"], [], [], [], 1, 0
    ],
    [
        ["Symbol_4", "Symbol_6", "Symbol_3", "Symbol_6", "Symbol_4", "Symbol_4", "Symbol_5", "Symbol_2", "Symbol_2"], [], [], [], 1, 0
    ],
    [
        ["Symbol_2", "Symbol_4", "Symbol_1", "Symbol_3", "Symbol_4", "Symbol_6", "Symbol_6", "Symbol_0", "Symbol_3"], [], [], [], 1, 0
    ],
    [
        ["Symbol_3", "Symbol_4", "Symbol_1", "Symbol_6", "Symbol_4", "Symbol_5", "Symbol_2", "Symbol_1", "Symbol_6"], [], [], [], 1, 0
    ],
    [
        ["Symbol_6", "Symbol_0", "Symbol_1", "Symbol_3", "Symbol_4", "Symbol_2", "Symbol_3", "Symbol_2", "Symbol_1"], [], [], [], 1, 0
    ],
    [
        ["Symbol_3", "Symbol_6", "Symbol_5", "Symbol_5", "Symbol_3", "Symbol_4", "Symbol_5", "Symbol_2", "Symbol_2"], [], [], [], 1, 0
    ],

];

$demoWinResults = [
    [
        [
            "Symbol_2", "Symbol_5", "Symbol_0", "Symbol_5", "Symbol_0", "Symbol_4", "Symbol_2", "Symbol_4", "Symbol_3"
        ],
        [7, 5, 3],
        [
            [
                "index" => 5,
                "name" => "Symbol_2",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 30,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [
                    1,
                    2,
                    3
                ]
            ]
        ],
        [],
        2,
        30
    ], //x6 mult
    [
        [
            "Symbol_3", "Symbol_4", "Symbol_2", "Symbol_6", "Symbol_0", "Symbol_5", "Symbol_2", "Symbol_2", "Symbol_4"
        ],
        [7, 5, 3],
        [
            [
                "index" => 5,
                "name" => "Symbol_2",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 15,
                "multiply" => 0,
                "win_amount" => 9,
                "active_icon" => [
                    7,
                    8,
                    9
                ]
            ]
        ],
        [],
        6,
        30  //x6 mult
    ],
    //SUPERMEGAWIN 1:50
    [
        [
            "Symbol_2", "Symbol_0", "Symbol_3", "Symbol_4", "Symbol_0", "Symbol_5", "Symbol_6", "Symbol_1", "Symbol_0"
        ],
        [1, 5, 9],
        [
            [
                "index" => 4,
                "name" => "Symbol_2",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 250,
                "multiply" => 0,
                "win_amount" => 50,
                "active_icon" => [
                    1,
                    5,
                    9
                ]
            ]
        ],
        [],
        0,
        250
    ],
    [
        [
            "Symbol_2", "Symbol_0", "Symbol_3", "Symbol_4", "Symbol_0", "Symbol_5", "Symbol_6", "Symbol_1", "Symbol_0"
        ],
        [1, 5, 9],
        [
            [
                "index" => 4,
                "name" => "Symbol_2",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 250,
                "multiply" => 0,
                "win_amount" => 50,
                "active_icon" => [
                    1,
                    5,
                    9
                ]
            ]
        ],
        [],
        0,
        250     //SUPERMEGAWIN 1:50
    ],
    [
        [
            "Symbol_3", "Symbol_0", "Symbol_2", "Symbol_3", "Symbol_0", "Symbol_3", "Symbol_5", "Symbol_4", "Symbol_5"
        ],
        [4, 5, 6],

        [
            [
                "index" => 1,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 100,
                "multiply" => 0,
                "win_amount" => 50,
                "active_icon" => [
                    4,
                    5,
                    6
                ]
            ]
        ],
        [],
        0,
        100
    ],         //SUPERWIN 1:20

    [
        [
            "Symbol_4", "Symbol_1", "Symbol_3", "Symbol_6", "Symbol_0", "Symbol_5", "Symbol_3", "Symbol_1", "Symbol_5"
        ],
        [7, 5, 3],

        [
            [
                "index" => 5,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 100,
                "multiply" => 0,
                "win_amount" => 20,
                "active_icon" => [
                    7,
                    5,
                    3
                ]
            ]
        ],
        [],
        0,
        100
    ],      //SUPERMEGAWIN 1:20 diferente
    [
        [
            "Symbol_2", "Symbol_2", "Symbol_5", "Symbol_5", "Symbol_5", "Symbol_2", "Symbol_5", "Symbol_1", "Symbol_5"
        ],
        [7, 5, 3],
        [
            [
                "index" => 5,
                "name" => "Symbol_5",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 50,
                "multiply" => 0,
                "win_amount" => 10,
                "active_icon" => [
                    7,
                    5,
                    3
                ]
            ]
        ],
        [],
        0,
        50
    ], // x10
];

// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout, FreeSpin, FeatureSymbol
$winResults = [
    [
        [
            "Symbol_6", "Symbol_0", "Symbol_5", "Symbol_1",  "Symbol_0", "Symbol_6", "Symbol_1", "Symbol_0", "Symbol_6"
        ],
        [1, 5, 9],
        [
            [
                "index" => 4,
                "name" => "Symbol_6",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 4,
                "multiply" => 0,
                "win_amount" => 0.8,
                "active_icon" => [
                    1,
                    5,
                    9
                ]
            ]
        ], [], 2, 3, 0, ""
    ],
    [
        [
            "Symbol_3",
            "Symbol_0",
            "Symbol_4",
            "Symbol_3",
            "Symbol_0",
            "Symbol_4",
            "Symbol_4",
            "Symbol_0",
            "Symbol_5"
        ],
        [7, 5, 3],
        [
            [
                "index" => 5,
                "name" => "Symbol_4",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 10,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [
                    7,
                    5,
                    3
                ]
            ]
        ],
        [],
        2,
        30, 0
    ],
    [
        [
            "Symbol_2", "Symbol_4", "Symbol_1", "Symbol_2", "Symbol_1", "Symbol_4", "Symbol_3", "Symbol_3", "Symbol_3"
        ],
        [7, 8, 9],
        [
            [
                "index" => 3,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 15,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [
                    7,
                    8,
                    9
                ]
            ]
        ],
        [],
        2,
        15,
        0
    ],
    [
        [
            "Symbol_3", "Symbol_3", "Symbol_3", "Symbol_6", "Symbol_5", "Symbol_2", "Symbol_4", "Symbol_4", "Symbol_1"
        ],
        [1, 2, 3],
        [
            [
                "index" => 2,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 15,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [
                    1,
                    2,
                    3
                ]
            ]
        ],
        [],
        2,
        15,
        0
    ],

    [
        [
            "Symbol_2", "Symbol_4", "Symbol_6", "Symbol_2", "Symbol_6", "Symbol_6", "Symbol_6", "Symbol_0", "Symbol_2"
        ],
        [7, 5, 3],
        [
            [
                "index" => 5,
                "name" => "Symbol_6",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 30,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [
                    7,
                    5,
                    3
                ]
            ]
        ],
        [],
        2,
        4,
        0
    ],
    [
        [
            "Symbol_2", "Symbol_2", "Symbol_4", "Symbol_2", "Symbol_0", "Symbol_4", "Symbol_3", "Symbol_3", "Symbol_3"
        ],
        [7, 8, 9],
        [
            [
                "index" => 3,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 15,
                "multiply" => 0,
                "win_amount" => 9,
                "active_icon" => [
                    7,
                    8,
                    9
                ]
            ]
        ],
        [],
        2,
        15,
        0
    ],

    [
        [
            "Symbol_2", "Symbol_6", "Symbol_2", "Symbol_5", "Symbol_5", "Symbol_5", "Symbol_5", "Symbol_4", "Symbol_2"
        ],
        [4, 5, 6],
        [
            [
                "index" => 1,
                "name" => "Symbol_5",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 5,
                "multiply" => 0,
                "win_amount" => 1,
                "active_icon" => [
                    4,
                    5,
                    6
                ]
            ]
        ],
        [],
        0,
        5,
        0
    ],



];
 
//////////////////////////// COMMON /////////////////////////////////////////
// Just after results array declaration
 
$winResults = [
    [
        [
            "Symbol_2",
            "Symbol_6",
            "Symbol_1",
            "Symbol_2",
            "Symbol_1",
            "Symbol_6",
            "Symbol_3",
            "Symbol_3",
            "Symbol_3",
        ],
        [7, 8, 9],
        [
            [
                "index" => 3,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 15,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [7, 8, 9],
            ],
        ],
        [],
        2,
        15,
        0,
    ],
    [
        [
            "Symbol_6",
            "Symbol_0",
            "Symbol_0",
            "Symbol_2",
            "Symbol_2",
            "Symbol_1",
            "Symbol_3",
            "Symbol_3",
            "Symbol_1",
        ],
        [1, 2, 3],
        [
            [
                "index" => 2,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 15,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [1, 2, 3],
            ],
        ],
        [],
        2,
        5,
        0,
    ],
    [
        [
            "Symbol_2",
            "Symbol_6",
            "Symbol_2",
            "Symbol_2",
            "Symbol_1",
            "Symbol_6",
            "Symbol_3",
            "Symbol_3",
            "Symbol_3",
        ],
        [7, 8, 9],
        [
            [
                "index" => 3,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 20,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [7, 8, 9],
            ],
        ],
        [],
        2,
        20,
        0,
    ],
    [
        [
            "Symbol_1",
            "Symbol_6",
            "Symbol_6",
            "Symbol_2",
            "Symbol_1",
            "Symbol_6",
            "Symbol_0",
            "Symbol_2",
            "Symbol_2",
        ],
        [7, 8, 9],
        [
            [
                "index" => 3,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 15,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [7, 8, 9],
            ],
        ],
        [],
        2,
        50,
        0,
    ],
    [
        [
            "Symbol_6",
            "Symbol_3",
            "Symbol_1",
            "Symbol_2",
            "Symbol_6",
            "Symbol_1",
            "Symbol_0",
            "Symbol_2",
            "Symbol_6",
        ],
        [1, 5, 9],
        [
            [
                "index" => 3,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 15,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [1, 5, 9],
            ],
        ],
        [],
        2,
        5,
        0,
    ],
    [
        [
            "Symbol_3",
            "Symbol_6",
            "Symbol_1",
            "Symbol_2",
            "Symbol_3",
            "Symbol_1",
            "Symbol_0",
            "Symbol_2",
            "Symbol_3",
        ],
        [1, 5, 9],
        [
            [
                "index" => 1,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 20,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [1, 5, 9],
            ],
        ],
        [],
        2,
        20,
        0,
    ],
    [
        [
                "Symbol_5",
                "Symbol_1",
                "Symbol_2",
                "Symbol_4",
                "Symbol_4",
                "Symbol_4",
                "Symbol_4",
                "Symbol_4",
                "Symbol_3"
        ],
        [4 ,5 ,6],
        [
            [
                "index" => 1,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 80,
                "multiply" => 0,
                "win_amount" => 4,
                "active_icon" => [4 ,5 ,6],
            ],
        ],
        [],
        2,
        80,
        0,
    ],
];
$loseResults = [
    [
        ["Symbol_5", "Symbol_3", "Symbol_6", "Symbol_2", "Symbol_2", "Symbol_1", "Symbol_1", "Symbol_5", "Symbol_3"], [], [], [], 1, 0
    ],  
    [
        ["Symbol_3", "Symbol_6", "Symbol_5", "Symbol_5", "Symbol_3", "Symbol_6", "Symbol_1", "Symbol_2", "Symbol_2"], [], [], [], 1, 0
    ],  [
        ["Symbol_5", "Symbol_1", "Symbol_3", "Symbol_1", "Symbol_2", "Symbol_6", "Symbol_3", "Symbol_6", "Symbol_5"], [], [], [], 1, 0
    ],
    // Repeating:
    [
        ["Symbol_5", "Symbol_3", "Symbol_6", "Symbol_2", "Symbol_2", "Symbol_1", "Symbol_1", "Symbol_5", "Symbol_3"], [], [], [], 1, 0
    ],  
    [
        ["Symbol_3", "Symbol_6", "Symbol_5", "Symbol_5", "Symbol_3", "Symbol_6", "Symbol_1", "Symbol_2", "Symbol_2"], [], [], [], 1, 0
    ],  [
        ["Symbol_5", "Symbol_1", "Symbol_3", "Symbol_1", "Symbol_2", "Symbol_6", "Symbol_3", "Symbol_6", "Symbol_5"], [], [], [], 1, 0
    ],
    
    [
        ["Symbol_5", "Symbol_3", "Symbol_6", "Symbol_2", "Symbol_2", "Symbol_1", "Symbol_1", "Symbol_5", "Symbol_3"], [], [], [], 1, 0
    ],  
    [
        ["Symbol_3", "Symbol_6", "Symbol_5", "Symbol_5", "Symbol_3", "Symbol_6", "Symbol_1", "Symbol_2", "Symbol_2"], [], [], [], 1, 0
    ],  [
        ["Symbol_5", "Symbol_1", "Symbol_3", "Symbol_1", "Symbol_2", "Symbol_6", "Symbol_3", "Symbol_6", "Symbol_5"], [], [], [], 1, 0
    ],
    
    [
        ["Symbol_5", "Symbol_3", "Symbol_6", "Symbol_2", "Symbol_2", "Symbol_1", "Symbol_1", "Symbol_5", "Symbol_3"], [], [], [], 1, 0
    ],  
    [
        ["Symbol_3", "Symbol_6", "Symbol_5", "Symbol_5", "Symbol_3", "Symbol_6", "Symbol_1", "Symbol_2", "Symbol_2"], [], [], [], 1, 0
    ],  [
        ["Symbol_5", "Symbol_1", "Symbol_3", "Symbol_1", "Symbol_2", "Symbol_6", "Symbol_3", "Symbol_6", "Symbol_5"], [], [], [], 1, 0
    ],
];

 
shuffle($winResults);
shuffle($loseResults);


$winLength = 2; // 3
$loseLength = 8;

$winResults = array_slice($winResults, 0, $winLength);
$loseResults = array_slice($loseResults, 0, $loseLength);

$possibleResults = array_merge($winResults, $loseResults);
shuffle($possibleResults);
$result = $possibleResults[0];

///////////////////////////////////////////////////////////////////////////

$_POST = json_decode(file_get_contents("php://input"), true);
//$_POST['numline'] = 2;

$cpl = floatval($_POST['cpl']);
$amount = floatval($_POST['betamount']);
$numline =   floatval($_POST['numline']);
$bet = $amount * $cpl * $numline;

/////////////////////////////// COMMOM /////////////////////////////////
// Just after $bet declaration

if ($user['saldo'] + $user['bonus'] < $bet) die("Insuficient saldos");

else {
    if ($user['saldo'] >= $bet) {
        Q("UPDATE usuarios SET saldo=saldo-$bet WHERE usuario='$token'");
    } else {
        $disc = $bet - $user['saldo'];
        Q("UPDATE usuarios SET saldo=0 WHERE usuario='$token'");
        Q("UPDATE usuarios SET bonus=bonus-$disc WHERE usuario='$token'");
    }
}

// Q($query);

// To $winAmount declaration
///////////////////////////////////////////////////////////////////////

$winAmount = $cpl * $amount * $result[PAYOUT];

if($winAmount <= 0) {
    shuffle($result[0]);
}


$result[ACTIVELINES][0]["win_amount"] = $winAmount;
Q("UPDATE usuarios SET saldo=saldo+$winAmount WHERE usuario='$token'");

$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();




$pull = [
    "WinAmount" => $winAmount,
    "WinOnDrop" => $winAmount,
    "TotalWay" => 27,
    "FreeSpin" => $result[FREESPIN] * (-1),
    "LastMultiply" => 0,
    "WildFixedIcons" => [],
    "HasJackpot" => false,
    "HasScatter" => false,
    "CountScatter" => 0,
    "WildColumIcon" => "",
    "MultipyScatter" => 0,
    "MultiplyCount" => 2,
    "SlotIcons" => $result[0],
    "ActiveIcons" => $result[1],
    "ActiveLines" => $result[2],
    "WinLogs" => [
        
    ],
    "DropLine" => 3,
    "DropLineData" => $result[3],
    "MultipleList" => [
        1,
        2,
        3,
        5
    ]
];



$data = [
    "bet" => $bet,

    "credit" => $user['saldo'] + $user['bonus'],
    "freemode" => true,
    "jackpot" => 0,
    "free_spin" => 0,
    "free_num" => $freeNum,
    "scaler" => 0,
    "num_line" => $_POST['numline'],
    "cpl" => $cpl,
    "betamount" => $amount,
    "bet_amount" => $bet,
    "pull" => $pull
];

if ($result[FREESPIN]) {
    $data['feature_symbol'] = $result[FEATURESYMBOL];
}


S("success", true);
S("data", $data);
S("message", "Spin success");
R();
