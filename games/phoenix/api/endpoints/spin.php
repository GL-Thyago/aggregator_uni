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

// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout
$loseResults = [
    [
        ["Symbol_5", "Symbol_3", "Symbol_6", "Symbol_2", "Symbol_2", "Symbol_1", "Symbol_3", "Symbol_4", "Symbol_3"], [], [], [], 1, 0
    ],

    [
        ["Symbol_5", "Symbol_4", "Symbol_3", "Symbol_3", "Symbol_3", "Symbol_2", "Symbol_2", "Symbol_0", "Symbol_1"], [], [], [], 1, 0
    ],

    [
        ["Symbol_5", "Symbol_1", "Symbol_3", "Symbol_1", "Symbol_4", "Symbol_6", "Symbol_3", "Symbol_6", "Symbol_1"], [], [], [], 1, 0
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


// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout
$winResults = [
    [
        [
            "Symbol_6", "Symbol_3", "Symbol_8", "Symbol_0", "Symbol_9", "Symbol_5", "Symbol_0", "Symbol_5", "Symbol_9", "Symbol_3"
        ],
        [6, 7, 8, 4, 14, 15],
        [
            [
                "index" => 6,
                "name" => "Symbol_5",
                "combine" => 5,
                "way_243" => 2,
                "payout" => 50,
                "multiply" => 0,
                "win_amount" => 5,
                "active_icon" => [
                     6, 7, 8, 4, 14, 15
                ]
            ]
        ], [], 2, 100
    ],
[
        [
            "Symbol_3", "Symbol_0", "Symbol_8", "Symbol_4", "Symbol_7", "Symbol_8", "Symbol_0", "Symbol_3", "Symbol_7", "Symbol_7"
        ],
        [1, 2, 7, 8, 6, 12, 3],
        [
            [
                "index" => 1,
                "name" => "Symbol_3",
                "combine" => 3,
                "way_243" => 2,
                "payout" => 15,
                "multiply" => 0,
                "win_amount" => 1.5,
                "active_icon" => [
                     1, 2, 7, 8
                ]
            ]
        ], [], 2, 30
    ],
        [
        [
            "Symbol_7", "Symbol_7", "Symbol_6", "Symbol_3", "Symbol_0", "Symbol_6", "Symbol_5", "Symbol_3", "Symbol_2", "Symbol_5"
        ],
        [6, 12, 3, 11, 8, 4, 5],
        [
            [
                "index" => 6,
                "name" => "Symbol_6",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 30,
                "multiply" => 0,
                "win_amount" => 1.5,
                "active_icon" => [
                     6, 12, 3
                ]
            ]
        ], [], 2, 60
    ],
            [
        [
            "Symbol_6", "Symbol_5", "Symbol_5", "Symbol_3", "Symbol_9", "Symbol_2", "Symbol_3", "Symbol_4", "Symbol_9", "Symbol_5"
        ],
        [11, 2, 3, 13],
        [
            [
                "index" => 11,
                "name" => "Symbol_5",
                "combine" => 3,
                "way_243" => 2,
                "payout" => 6,
                "multiply" => 0,
                "win_amount" => 0.6,
                "active_icon" => [
                     11, 2, 3, 13
                ]
            ]
        ], [], 2, 12
    ],
                [
        [
            "Symbol_9", "Symbol_9", "Symbol_9", "Symbol_8", "Symbol_9", "Symbol_6", "Symbol_5", "Symbol_6", "Symbol_2", "Symbol_2"
        ],
        [1, 2, 3, 13],
        [
            [
                "index" => 11,
                "name" => "Symbol_9",
                "combine" => 3,
                "way_243" => 2,
                "payout" => 10,
                "multiply" => 0,
                "win_amount" => 1,
                "active_icon" => [
                     1, 2, 3, 13
                ]
            ]
        ], [], 2, 20
    ],
                    [
        [
            "Symbol_5", "Symbol_4", "Symbol_3", "Symbol_6", "Symbol_7", "Symbol_6", "Symbol_0", "Symbol_3", "Symbol_4", "Symbol_9"
        ],
        [6, 11, 7, 13, 4, 15],
        [
            [
                "index" => 6,
                "name" => "Symbol_6",
                "combine" => 5,
                "way_243" => 2,
                "payout" => 150,
                "multiply" => 0,
                "win_amount" => 15,
                "active_icon" => [
                     6, 11, 7, 13, 4, 15
                ]
            ]
        ], [], 2, 300
    ],
                    [
        [
            "Symbol_9", "Symbol_2", "Symbol_5", "Symbol_9", "Symbol_4", "Symbol_9", "Symbol_6", "Symbol_3", "Symbol_5", "Symbol_2"
        ],
        [11, 12, 3, 9, 15],
        [
            [
                "index" => 11,
                "name" => "Symbol_5",
                "combine" => 5,
                "way_243" => 1,
                "payout" => 50,
                "multiply" => 0,
                "win_amount" => 25,
                "active_icon" => [
                     11, 12, 3, 9, 15
                ]
            ]
        ], [], 2, 100
    ],
                    [
        [
            "Symbol_5", "Symbol_9", "Symbol_5", "Symbol_8", "Symbol_5", "Symbol_8", "Symbol_0", "Symbol_2", "Symbol_5", "Symbol_9"
        ],
        [1, 7, 3, 9, 14, 5, 6, 13, 4, 11],
        [
            [
                "index" => 1,
                "name" => "Symbol_5",
                "combine" => 5,
                "way_243" => 2,
                "payout" => 50,
                "multiply" => 30,
                "win_amount" => 150,
                "active_icon" => [
                     1, 7, 3, 9, 14, 5
                ]
            ]
        ], [], 2, 100
    ],
];

//////////////////////////// COMMON /////////////////////////////////////////
// Just after results array declaration

shuffle($winResults);
shuffle($loseResults);

 
    $winLength = 1;
    $loseLength = 9;
 

$winResults = array_slice($winResults, 0, $winLength);
$loseResults = array_slice($loseResults, 0, $loseLength);

$possibleResults = array_merge($winResults, $loseResults);
shuffle($possibleResults);
$result = $possibleResults[0];

///////////////////////////////////////////////////////////////////////////


$cpl = intval($_POST['cpl']);
$amount = floatval($_POST['betamount']);
$numline = intval($_POST['numline']);
$bet = $amount * $cpl * $numline;

/////////////////////////////// COMMOM /////////////////////////////////
// Just after $bet declaration

if ($user['saldo'] + $user['bonus'] < $bet) die("Insuficient credits");
else {
    if ($user['saldo'] >= $bet) {
        $query = "UPDATE usuarios SET saldo=saldo-$bet WHERE usuario='$token'";
    } else {
        $query = "UPDATE usuarios SET saldo=0 WHERE usuario='$token'";
        $disc = $bet - $user['saldo'];
        Q("UPDATE usuarios SET bonus=$disc WHERE usuario='$token'");
    }
}

Q($query);

// To $winAmount declaration
///////////////////////////////////////////////////////////////////////

$winAmount = $cpl * $amount * $result[PAYOUT];


$result[ACTIVELINES][0]["win_amount"] = $winAmount;
Q("UPDATE usuarios SET saldo=saldo+$winAmount WHERE usuario='$token'");

$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();




$pull = [
    "WinAmount" => $winAmount,
    "WinOnDrop" => $winAmount,
    "TotalWay" => 27,
    "FreeSpin" => 0,
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
        "[BET] betLevel: 10, betSize:10, baseBet:20.00 => 2000",
        "[WIN] line 1: 4[Symbol_5] payout: 25 (*multipy:1) x 10 x 10 => 2500"
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
    "credit" => $user['saldo'] + $user['bonus'],
    "freemode" => false,
    "jackpot" => 0,
    "free_spin" => 0,
    "free_num" => 0,
    "scaler" => 0,
    "num_line" => $_POST['numline'],
    "cpl" => $cpl,
    "betamount" => 20, //$amount,
    "bet_amount" => 20, //$bet,
    "pull" => $pull
];

 



S("success", true);
S("data", $data);
S("message", "Spin success");
R();
