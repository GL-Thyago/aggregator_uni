<?php
$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();
if (!$user) die("Err user not found");
$data = new stdClass();

$data->user_name = $user['nome'];
$data->credit = $user['saldo'];
$data->num_line = 20;
$data->line_num = 20;
$data->bet_amount = 0.02;

$data->free_num = 0;
$data->free_total = 0;
$data->free_amount = 0;
$data->free_multi = 0;
$data->freespin_mode = 0;
$data->multiple_list = [];
$data->credit_line = 1;
$data->buy_feature = 50;
$data->buy_max = 1300;
$data->feature = [];
$data->total_way = 27;
$data->multiply = 0;
$data->icon_data = [
    "Symbol_2",
    "Symbol_7",
    "Symbol_9",
    "Symbol_10",
    "Symbol_4",
    "Symbol_6",
    "Symbol_5",
    "Symbol_0:3:1",
    "Symbol_5",
    "Symbol_3",
    "Symbol_3",
    "Symbol_10",
    "_skip",
    "Symbol_0:2:1",
    "Symbol_3",
    "Symbol_7",
    "Symbol_8",
    "_skip",
    "_skip",
    "Symbol_7"
];
$data->active_lines = [
    [
        "name" => "Symbol_4",
        "index" => 3,
        "payout" => 10,
        "combine" => 3,
        "way_243" => 1,
        "multiply" => 0,
        "win_amount" => 2,
        "active_icon" => [
            7,
            8,
            9
        ]
    ]
];
$data->drop_line = [];
$data->currency_prefix = $currencyPrefix;
$data->currency_suffix = $currencySuffix;
$data->currency_thousand = ".";
$data->currency_decimal = ",";
$data->bet_size_list = [
    "0.02",
    "0.04",
    "1",
    "10"
];
$data->previous_session = false;
$data->game_state = "";
S("success", true);
S("data", $data);
S("message", "Load sessions success");
R();
